#!/usr/bin/env node
// 局域网联机中继服务器（零依赖）：同时托管 games.html 并提供 WebSocket 房间中继。
// 用法： node lan-server.js            （默认端口 8787）
//        PORT=9000 node lan-server.js
// 然后用手机/电脑浏览器打开 http://<本机局域网IP>:8787/ 即可。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 自动探测本机局域网 IPv4（Mac/Windows/Linux 通用，优先 wifi/以太网）
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const PORT = process.env.PORT || 8787;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function findHtml() {
  const cands = [
    path.join(__dirname, 'games.html'),
    '/Users/chaohua/Documents/请输入文本/games.html',
    path.join(process.cwd(), 'games.html')
  ];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return cands[0];
}
const FILE = findHtml();

// 房间： code -> { host:ws, guest:ws|null, game:string }
const rooms = new Map();
function genCode() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); }
  while (rooms.has(c));
  return c;
}

// ---------- HTTP：托管 games.html ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html' || url === '/games.html') {
    fs.readFile(FILE, (err, buf) => {
      if (err) { res.writeHead(500); res.end('games.html not found: ' + FILE); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok rooms=' + rooms.size);
  } else if (url === '/favicon.ico') {
    res.writeHead(204); res.end();
  } else {
    res.writeHead(404); res.end('not found');
  }
});

// ---------- WebSocket 握手 ----------
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const ws = { socket, role: null, room: null, alive: true,
    send: (data) => sendText(socket, data), close: () => socket.end() };
  setupWs(ws);
});

// ---------- 发送文本帧（服务端→客户端，不加掩码） ----------
function sendText(socket, str) {
  const payload = Buffer.from(str, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  } else {
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(payload.length), 0);
    header = Buffer.concat([Buffer.from([0x81, 127]), len]);
  }
  socket.write(Buffer.concat([header, payload]));
}

// ---------- 接收并解析帧（客户端→服务端，带掩码） ----------
function setupWs(ws) {
  let buf = Buffer.alloc(0);
  let dead = false;
  const disc = () => { if (dead) return; dead = true; onDisconnect(ws); };
  ws.socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    buf = parseFrames(ws, buf);
  });
  ws.socket.on('close', disc);
  ws.socket.on('end', disc);
  ws.socket.on('error', disc);
}

function parseFrames(ws, buf) {
  while (true) {
    if (buf.length < 2) return buf;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return buf;
      len = buf.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return buf;
      len = Number(buf.readBigUInt64BE(2)); offset = 10;
    }
    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return buf;
      maskKey = buf.slice(offset, offset + 4); offset += 4;
    }
    if (buf.length < offset + len) return buf;
    let payload = buf.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    offset += len;
    buf = buf.slice(offset);
    if (opcode === 0x8) { try { ws.close(); } catch (e) {} return buf; } // close
    if (opcode === 0x1 || opcode === 0x0) {
      try { handleMsg(ws, payload.toString('utf8')); } catch (e) {}
    }
    // 继续解析下一个帧
  }
}

// ---------- 业务路由 ----------
function handleMsg(ws, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.t === 'create') {
    const code = genCode();
    rooms.set(code, { host: ws, guest: null, game: m.game });
    ws.room = code; ws.role = 'host';
    sendText(ws.socket, JSON.stringify({ t: 'created', code, role: 'host', game: m.game }));
    log('房间创建', code, m.game);
  } else if (m.t === 'join') {
    const room = rooms.get(m.code);
    if (!room) { sendText(ws.socket, JSON.stringify({ t: 'err', msg: '房间不存在' })); return; }
    if (room.guest) { sendText(ws.socket, JSON.stringify({ t: 'err', msg: '房间已满' })); return; }
    if (room.game !== m.game) { sendText(ws.socket, JSON.stringify({ t: 'err', msg: '双方选择的棋类不一致（房主：' + room.game + '）' })); return; }
    room.guest = ws; ws.room = m.code; ws.role = 'guest';
    sendText(room.host.socket, JSON.stringify({ t: 'peer' }));
    sendText(ws.socket, JSON.stringify({ t: 'paired', role: 'guest', code: m.code, game: room.game }));
    log('对手加入', m.code, m.game);
  } else if (m.t === 'state') {
    const room = rooms.get(ws.room);
    if (!room) return;
    const other = ws.role === 'host' ? room.guest : room.host;
    if (other && other.socket) sendText(other.socket, JSON.stringify({ t: 'state', game: m.game, s: m.s }));
  }
}

function onDisconnect(ws) {
  const code = ws.room;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const other = ws.role === 'host' ? room.guest : room.host;
  if (other && other.socket) sendText(other.socket, JSON.stringify({ t: 'left' }));
  if (ws.role === 'host') rooms.delete(code);
  else room.guest = null;
  log('断开', code);
}

function log(...a) { console.log('[lan]', new Date().toLocaleTimeString(), ...a); }

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('==================================================');
  console.log(' 棋类游戏 · 局域网联机服务器已启动');
  console.log(' 本机打开:   http://localhost:' + PORT + '/');
  if (ips.length) {
    console.log(' 手机/iPad 打开（任选其一，需与电脑同一 WiFi）:');
    ips.forEach(ip => console.log('   →  http://' + ip + ':' + PORT + '/'));
  } else {
    console.log(' 未检测到局域网 IP，请确认 Mac 已连接 WiFi/以太网。');
  }
  console.log(' 房间码在「联机」面板创建后显示。');
  console.log(' 若手机连不上：请在 Mac 弹出的「防火墙」提示中点「允许」');
  console.log('==================================================');
});

// 部署到免费托管平台（Render/Railway/Fly 等）时：平台注入 PORT 并监听 0.0.0.0；
// 页面经平台 https 访问，前端会自动用 wss://，平台在边缘做 TLS 终结并转发明文 ws，无需在应用内配证书。
// 健康检查端点 /health 已就位，可在平台后台设为 Health Check。
