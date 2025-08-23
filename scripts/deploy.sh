#!/bin/bash
npm run build

# 启动应用并记录正确的PID
nohup node dist/main.js --config env.prod.yaml > app.log 2>&1 &
APP_PID=$!
echo $APP_PID > app.pid

echo "应用已启动，PID: $APP_PID"
