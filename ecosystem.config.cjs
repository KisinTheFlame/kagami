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
  ],
};
