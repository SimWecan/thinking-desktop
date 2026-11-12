/**
 * Zstd 会话轮询连接器：多层目录发现、增量消费、多会话并行。
 * 运行：node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ZstdJsonlPollConnector } from "../connectors/zstd-jsonl-poll.mjs";

const hasZstd = spawnSync("zstd", ["--version"], { encoding: "utf8" }).status === 0;
const opts = { skip: hasZstd ? false : "系统未安装 zstd" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 模拟 DSH：每行一个独立 zstd frame 追加到同一文件 */
function appendFrame(file, obj) {
  const buf = execFileSync("zstd", ["-q", "-c"], { input: JSON.stringify(obj) + "\n" });
  appendFileSync(file, buf);
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "td-zstd-"));
  const dir = join(root, "--Users-sim-demo--", "session-abc");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.v4.jsonl.zstd");
  return { root, file };
}

function connector(root) {
  const got = [];
  const c = new ZstdJsonlPollConnector({
    source: "test",
    dir: root,
    intervalMs: 80,
    summarize: (o) => (o && o.type ? { type: "thought", payload: { t: o.type } } : null),
  });
  c.onEvent = (e) => got.push(e);
  c.start();
  return { c, got };
}

test("多层目录里的会话能被发现，启动时不回放历史", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "old-1" });
  appendFrame(file, { type: "old-2" });
  const { c, got } = connector(root);
  await wait(250);
  assert.equal(got.length, 0, "启动前的历史内容不应回放");
  assert.equal([...c._states.values()][0].seen, 2);

  appendFrame(file, { type: "new-1" });
  await wait(300);
  assert.equal(got.length, 1);
  assert.equal(got[0].payload.t, "new-1");
  c.stop();
});

test("文件没变化时不重复上报", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "a" });
  const { c, got } = connector(root);
  await wait(200);
  appendFrame(file, { type: "b" });
  await wait(250);
  await wait(250);
  assert.equal(got.length, 1);
  c.stop();
});

test("新出现的会话：先登记偏移，之后追加的事件照常上报", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "first-session" });
  const { c, got } = connector(root);
  await wait(150);

  const dir2 = join(root, "--Users-sim-other--", "session-def");
  mkdirSync(dir2, { recursive: true });
  const f2 = join(dir2, "session.v4.jsonl.zstd");
  appendFrame(f2, { type: "history" });
  await wait(250);
  assert.equal(got.length, 0);

  appendFrame(f2, { type: "live" });
  await wait(300);
  assert.equal(got.length, 1);
  assert.equal(got[0].payload.t, "live");
  assert.equal(c._states.size, 2, "两个活跃会话应同时被跟踪");
  c.stop();
});

test("窗口外的老会话不参与轮询", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "a" });
  const got = [];
  const c = new ZstdJsonlPollConnector({
    source: "test", dir: root, intervalMs: 80, activeWindowMs: -1,
    summarize: () => ({ type: "thought" }),
  });
  c.onEvent = (e) => got.push(e);
  c.start();
  await wait(250);
  assert.equal(c._states.size, 0);
  c.stop();
});

test("文件被重写回滚时不刷屏", opts, async () => {
  const { root, file } = setup();
  for (let i = 0; i < 5; i++) appendFrame(file, { type: `old-${i}` });
  const { c, got } = connector(root);
  await wait(200);
  writeFileSync(file, execFileSync("zstd", ["-q", "-c"], { input: JSON.stringify({ type: "rewritten" }) + "\n" }));
  await wait(300);
  assert.equal(got.length, 0, "重写/回滚不应回放整段历史");
  c.stop();
});

test("首次见到会话时可按尾部恢复进行中的回合（onFirstSight）", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "turn/start" });
  appendFrame(file, { type: "tool/call" });
  const got = [];
  const c = new ZstdJsonlPollConnector({
    source: "test", dir: root, intervalMs: 80,
    summarize: () => null,
    onFirstSight: (lines) =>
      lines.some((l) => l.includes('"turn/start"')) ? { type: "status", payload: { running: 1 } } : null,
  });
  c.onEvent = (e) => got.push(e);
  c.start();
  await wait(300);
  assert.equal(got.length, 1, "首次见到应补报一次回合进行中");
  assert.equal(got[0].type, "status");
  assert.equal(got[0].payload.running, 1);
  c.stop();
});

test("首次解码会扫描整文件的回合标记（尾巴里没有 turn/start 也能恢复）", opts, async () => {
  const { root, file } = setup();
  appendFrame(file, { type: "turn/start" });
  // 追加 200 行噪声：尾巴只留 160 行，turn/start 已经不在 lines 里
  const noise = Array.from({ length: 200 }, (_, i) => JSON.stringify({ type: "noise", i })).join("\n") + "\n";
  appendFileSync(file, execFileSync("zstd", ["-q", "-c"], { input: noise }));
  let marker = null;
  const c = new ZstdJsonlPollConnector({
    source: "test", dir: root, intervalMs: 80,
    summarize: () => null,
    firstSightMarker: /"type":"turn\/(?:start|end)"/,
    onFirstSight: (_lines, _f, m) => { marker = m; return null; },
  });
  c.onEvent = () => {};
  c.start();
  await wait(500);
  assert.ok(marker && marker.includes('"turn/start"'), "应记住整文件最后一条回合标记");
  c.stop();
});
