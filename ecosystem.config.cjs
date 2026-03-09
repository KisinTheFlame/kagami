/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "kagami-server",
      cwd: path.join(__dirname, "apps/server"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "kagami-web",
      cwd: __dirname,
      script: "scripts/web-server.mjs",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: "20004",
        API_TARGET: "http://localhost:20003",
      },
    },
  ],
};
