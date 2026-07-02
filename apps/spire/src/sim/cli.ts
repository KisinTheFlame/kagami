import { runBalance } from "./simulate.js";

// 自动对战 CLI：`pnpm --filter @kagami/spire-service sim -- --runs 1000 --policy greedy`
// 产出平衡报告（胜率 / 平均到达节点 / 平均剩余血 / 平均步数）。

function parseArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const runs = Number.parseInt(parseArg("runs", "1000"), 10);
const policyArg = parseArg("policy", "greedy");
const policy = policyArg === "random" ? "random" : "greedy";

const report = runBalance({ runs, policy });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
