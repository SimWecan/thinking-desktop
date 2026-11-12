/**
 * store 的「仍在工作」判定（busy）单测。
 *
 * 背景：长构建/长思考期间 DSH 会话文件不追加新行，只看 lastWorkAt（20s 窗口）
 * 会把还在跑回合的 agent 误判成收工 → 壁纸 30s 后停转。busy 要把
 * 「回合进行中 / 工具未返回」也算进来，同时不能被残留状态永久挂住。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStore } from "../server/core/store.mjs";
import { AgentRegistry } from "../server/agents.mjs";

const MIN = 60_000;

function harness() {
  const root = mkdtempSync(join(tmpdir(), "td-store-busy-"));
  const store = createStore({ root, fs });
  const agents = new AgentRegistry(root);
  const state = () => store.state({ agents, ui: {}, presence: {} });
  const push = (type, payload = {}, ts = Date.now(), source = "deepseek-harness") =>
    store.pushEvent({ source, type, ts, payload });
  const src = (source = "deepseek-harness") => state().sources.find((x) => x.source === source);
  const agent = (source = "deepseek-harness") => state().agents.find((x) => x.source === source);
  const dispose = () => { store.flushOnExit(); rmSync(root, { recursive: true, force: true }); };
  return { store, state, push, src, agent, dispose };
}

test("回合进行中：60s 没有新事件仍然 busy（长构建不误判收工）", () => {
  const h = harness();
  try {
    h.push("status", { running: 1 }, Date.now() - 60_000);
    const s = h.src();
    assert.equal(s.busy, true);
    assert.equal(s.turn, true);
    assert.equal(h.agent().thinking, true);   // /agents 与托盘/看板同一口径
  } finally { h.dispose(); }
});

test("回合结束：turn/end 立即解除 busy", () => {
  const h = harness();
  try {
    h.push("status", { running: 1 }, Date.now() - 120_000);
    assert.equal(h.src().busy, true);
    h.push("status", { running: 0 }, Date.now() - 60_000);
    const s = h.src();
    assert.equal(s.busy, false);
    assert.equal(s.turn, false);
    assert.equal(h.agent().thinking, false);
  } finally { h.dispose(); }
});

test("工具未返回：tool_call 之后保持 busy，tool_result 收尾后按事件窗口回落", () => {
  const h = harness();
  try {
    h.push("tool_call", { name: "bash" }, Date.now() - 90_000);
    assert.equal(h.src().openTools, 1);
    assert.equal(h.src().busy, true);
    h.push("tool_result", {}, Date.now() - 60_000);
    assert.equal(h.src().openTools, 0);
    assert.equal(h.src().busy, false);        // 60s 前的结果，超出 WORK_HOLD
  } finally { h.dispose(); }
});

test("进程退出（无 turn/end）会清掉残留的回合/工具", () => {
  const h = harness();
  try {
    h.push("status", { running: 1 }, Date.now() - 60_000);
    h.push("tool_call", { name: "bash" }, Date.now() - 60_000);
    assert.equal(h.src().busy, true);
    h.push("status", { running: false, note: "app quit" }, Date.now());
    const s = h.src();
    assert.equal(s.busy, false);
    assert.equal(s.turn, false);
    assert.equal(s.openTools, 0);
  } finally { h.dispose(); }
});

test("残留回合不会永久挂住：完全静默超过 20 分钟自动失效", () => {
  const h = harness();
  try {
    h.push("status", { running: 1 }, Date.now() - 30 * MIN);
    assert.equal(h.src().busy, false);
  } finally { h.dispose(); }
});

test("进程守护的 boolean running 不会被当成回合（避免一开 App 就永久 busy）", () => {
  const h = harness();
  try {
    h.push("status", { running: true, note: "initial" }, Date.now() - 60_000);
    const s = h.src();
    assert.equal(s.turn, false);
    assert.equal(s.busy, false);
  } finally { h.dispose(); }
});
