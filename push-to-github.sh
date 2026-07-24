#!/bin/bash
# 一键把棋类联机服务器推送到 GitHub，随后可在 Render/Railway 关联部署。
# 用法： bash push-to-github.sh https://github.com/你的用户名/仓库名.git
set -e
if [ -z "$1" ]; then
  echo "用法: bash push-to-github.sh <你的GitHub仓库地址.git>"
  echo "示例: bash push-to-github.sh https://github.com/chaohua/chess-online.git"
  exit 1
fi
REPO="$1"

git init -q 2>/dev/null || true
git add lan-server.js games.html package.json .gitignore DEPLOY.html
git commit -m "棋类游戏联机服务器：可免费部署到 Render/Railway" || echo "(无新改动，跳过提交)"
git branch -M main 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git push -u origin main

echo ""
echo "✅ 已推送到 $REPO"
echo "下一步：在 Render(https://dashboard.render.com) 或 Railway(https://railway.app) 关联此仓库并 Deploy。"
