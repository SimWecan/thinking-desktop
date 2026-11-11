#!/usr/bin/env node
/**
 * 发版前验收：npm run release:check
 *
 * 依次执行固定验收流程，全部通过才允许发版：
 *   1. 单元测试（node --test：connector / 事件映射 / 活动度 / UI 逻辑）
 *   2. 端到端场景测试（scripts/e2e-test.mjs：单 agent / 多 agent / 形态切换 /
 *      动态静默 / 活动回归，真实数据三层隔离）
 *   3. 工作区检查（未提交改动提醒，不强制——有时是有意留着的）
 *
 * 退出码 0 = 可以发版；非 0 = 有环节失败，逐项修完再跑。
 */

import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const steps = [];
function run(title, cmd, args, opts = {}) {
  console.log(`\n■ ${title}`);
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  const out = (r.stdout || "") + (r.stderr || "");
  const tail = out.trim().split("\n").slice(-6).map((l) => "  " + l).join("\n");
  console.log(tail);
  const ok = r.status === 0;
  steps.push({ title, ok, sec: Math.round((Date.now() - t0) / 1000) });
  console.log(`  ${ok ? "✓ 通过" : "✗ 失败"}（${Math.round((Date.now() - t0) / 1000)}s）`);
  return ok;
}

console.log("Thinking Desktop · 发版验收");
try {
  const v = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  console.log(`版本 ${v}`);
} catch {}

const unit = run("单元测试", "npm", ["test"]);
const e2e = run("端到端场景测试", "node", ["scripts/e2e-test.mjs"], { env: { ...process.env } });

// 工作区状态提醒（不阻断：有时未提交改动是有意的）
let dirty = [];
try {
  const st = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
  dirty = st ? st.split("\n") : [];
} catch {}
console.log(`\n■ 工作区${dirty.length ? `（${dirty.length} 个未提交改动，确认是否有意）` : "干净"}`);

console.log("\n=== 验收结论 ===");
for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.title}（${s.sec}s）`);
const pass = steps.every((s) => s.ok);
console.log(pass
  ? "\n全部通过，可以发版：提交 → 打 tag（git tag v<版本> && git push --tags）→ GitHub Release"
  : "\n存在失败项，修完重跑 npm run release:check 再发版。");
process.exit(pass ? 0 : 1);
