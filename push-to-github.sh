#!/bin/bash
# 一键把棋类联机服务器推送到 GitHub，随后可在 Render/Railway 关联部署。
# 用法：
#   bash push-to-github.sh <仓库地址.git> [GitHub Personal Access Token]
# 例：
#   bash push-to-github.sh https://github.com/wss542/chess-online.git
#   bash push-to-github.sh https://github.com/wss542/chess-online.git ghp_xxxxxxxxxxxx
# 说明：GitHub 不支持账号密码推送，必须用 Personal Access Token（含 repo 权限）当密码。
#       填了 token 时，脚本会把它临时写进 push 地址，推完立即移除，不会留在配置里。
set -e
if [ -z "$1" ]; then
  echo "用法: bash push-to-github.sh <你的GitHub仓库地址.git> [Personal Access Token]"
  echo "示例: bash push-to-github.sh https://github.com/wss542/chess-online.git ghp_xxx"
  exit 1
fi
REPO="$1"
TOKEN="$2"

git init -q 2>/dev/null || true
git add lan-server.js games.html package.json .gitignore DEPLOY.html push-to-github.sh
git commit -m "棋类游戏联机服务器：可免费部署到 Render/Railway" || echo "(无新改动，跳过提交)"
git branch -M main 2>/dev/null || true
git remote remove origin 2>/dev/null || true

if [ -n "$TOKEN" ]; then
  # 临时把 token 写进地址做一次推送，推完移除，避免 token 留在 git 配置
  PUSH_URL="https://${TOKEN}@${REPO#https://}"
  git remote add origin "$PUSH_URL"
  # 若远端已有 GitHub 自动生成的初始提交(README 等)，先 fetch 再强制推送覆盖（本仓库为新建，安全）
  git fetch origin 2>/dev/null || true
  git push -u origin main --force-with-lease
  git remote set-url origin "$REPO"
  echo ""
  echo "✅ 已推送到 $REPO（token 已自动从本地配置移除）"
else
  git remote add origin "$REPO"
  echo "→ 接下来按提示输入：用户名=你的 GitHub 用户名，密码=Personal Access Token（不是登录密码）"
  git push -u origin main
  echo ""
  echo "✅ 已推送到 $REPO"
fi
echo "下一步：在 Render(https://dashboard.render.com) 或 Railway(https://railway.app) 关联此仓库并 Deploy。"
