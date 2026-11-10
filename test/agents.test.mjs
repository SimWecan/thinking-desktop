/**
 * AgentRegistry / 厂商预设 单元测试
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, VENDOR_PRESETS, detectInstalled } from "../server/agents.mjs";

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "td-agents-"));
}

test("厂商预设字段完整：名称/简称/颜色/动画缺一不可", () => {
  for (const [source, p] of Object.entries(VENDOR_PRESETS)) {
    assert.ok(p.name, `${source} 缺 name`);
    assert.ok(p.short, `${source} 缺 short`);
    assert.match(p.color, /^#[0-9a-fA-F]{6}$/, `${source} 颜色必须是 #RRGGBB`);
    assert.ok(p.anim, `${source} 缺 anim`);
  }
});

test("安装探测返回布尔映射，覆盖全部预设厂商", () => {
  const installed = detectInstalled();
  for (const source of Object.keys(VENDOR_PRESETS)) {
    assert.equal(typeof installed[source], "boolean", `${source} 探测结果必须是布尔`);
  }
});

test("默认绑定规则：已安装即启用，未安装不启用", () => {
  const reg = new AgentRegistry(tmpRoot());
  const installed = detectInstalled();
  for (const a of reg.agents(new Map())) {
    assert.equal(a.enabled, !!installed[a.source], `${a.source} 默认绑定应与安装状态一致`);
    assert.equal(a.color, VENDOR_PRESETS[a.source].color, "未配置时应回落到预设色");
  }
});

test("改色/解绑持久化到 config/agents.json，重开注册表后仍生效", () => {
  const root = tmpRoot();
  const reg = new AgentRegistry(root);
  reg.update("kimi-desktop", { color: "#FF5252", enabled: false });

  const file = join(root, "config", "agents.json");
  assert.ok(existsSync(file), "配置应落盘");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved["kimi-desktop"].color, "#FF5252");
  assert.equal(saved["kimi-desktop"].enabled, false);

  const reg2 = new AgentRegistry(root);
  const kimi = reg2.agents(new Map()).find((a) => a.source === "kimi-desktop");
  assert.equal(kimi.color, "#FF5252", "重开后改色仍生效");
  assert.equal(kimi.enabled, false, "重开后解绑仍生效");
});

test("thinking 只看真实工作事件（lastWorkAt），status 不算", () => {
  const reg = new AgentRegistry(tmpRoot());
  const now = Date.now();
  const stats = new Map([
    ["kimi-desktop", { events: 5, lastEventAt: now, lastType: "status", lastWorkAt: now - 60_000 }],
  ]);
  const kimi = reg.agents(stats, now).find((a) => a.source === "kimi-desktop");
  assert.equal(kimi.thinking, false, "60s 前的工作事件不应算思考中");

  stats.set("kimi-desktop", { events: 6, lastEventAt: now, lastType: "text", lastWorkAt: now - 3_000 });
  const kimi2 = reg.agents(stats, now).find((a) => a.source === "kimi-desktop");
  assert.equal(kimi2.thinking, true, "3s 前的工作事件应算思考中");
});

test("视图切换：默认 all，可设单一 agent，空值回落 all", () => {
  const reg = new AgentRegistry(tmpRoot());
  assert.equal(reg.view, "all");
  assert.equal(reg.setView("kimi-desktop"), "kimi-desktop");
  assert.equal(reg.setView(), "all");
  assert.equal(reg.setView(""), "all");
});
