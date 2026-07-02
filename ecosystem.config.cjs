const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "kagami-agent",
      cwd: path.join(__dirname, "apps/agent"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "kagami-console",
      cwd: path.join(__dirname, "apps/console"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 前门网关：静态托管 apps/web/dist + /api 反向代理。监听端口与上游地址全部自读
      // config.yaml 的 services 块，ecosystem 不再持有任何端口/地址（见 issue #162）。
      name: "kagami-gateway",
      cwd: path.join(__dirname, "apps/gateway"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "kagami-oss",
      cwd: path.join(__dirname, "apps/oss"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // metric 领域进程：独立 PM2 生命周期，一手包办 metric 摄取（agent HTTP 上报）+ metric-chart
      // 查询。监听端口自读 config.yaml 的 services.metric（默认 20010，仅 localhost）。
      name: "kagami-metric",
      cwd: path.join(__dirname, "apps/metric"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 浏览器进程：独立 PM2 生命周期，agent 重启不杀它（issue #173）。cwd 固定为仓库根，
      // 让 userDataDir(data/browser/default) 落在仓库根 data/ 下，登录态跨 agent 重启留存。
      name: "kagami-browser",
      cwd: __dirname,
      script: "apps/browser/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // LLM 网关 + OAuth 凭据中心：独立 PM2 生命周期，agent 重启不打断它与登录态。持有全部
      // provider + OAuth callback server（绑 1455/54545），未来多个 Agent 进程共享它。cwd 固定
      // 仓库根，让任何相对数据路径（DB / secret store）落在仓库根 data/ 下。
      name: "kagami-llm",
      cwd: __dirname,
      script: "apps/llm/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 尖塔卡牌游戏引擎：独立 PM2 生命周期，agent 重启不打断进行中的对局。cwd 固定仓库根，
      // 让存档 data/spire/ 落在仓库根 data/ 下，对局跨 agent / 本进程重启留存。
      name: "kagami-spire",
      cwd: __dirname,
      script: "apps/spire/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
