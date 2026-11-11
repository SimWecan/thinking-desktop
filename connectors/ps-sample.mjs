/**
 * 共享的进程快照：一次 `ps` 采样给所有需要进程信息的连接器用。
 *
 * 之前「活动度」和「进程守护」各自 spawn：2 个活动度 × 2s + 2 个守护 × 3s
 * ≈ 每秒 1.7 次进程创建，纯浪费。这里按 2s 缓存合并成每秒最多 1 次。
 */

import { spawnSync } from "node:child_process";

let cache = { at: 0, list: null };
let spawns = 0, hits = 0;

/** 采样统计：spawns = 真正执行 ps 的次数，hits = 命中缓存省掉的次数 */
export function psStats() {
  return { spawns, hits };
}

/** @returns {Array<{pid:number, cpu:number, comm:string}> | null} */
export function getProcesses(maxAgeMs = 2000) {
  const now = Date.now();
  if (cache.list && now - cache.at < maxAgeMs) { hits++; return cache.list; }
  spawns++;
  let out;
  try {
    out = spawnSync("/bin/ps", ["-A", "-o", "pid=,pcpu=,comm="], { encoding: "utf8" });
  } catch {
    return cache.list;
  }
  if (!out || out.status !== 0) return cache.list;
  const list = [];
  for (const line of String(out.stdout).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(.*)$/);
    if (m) list.push({ pid: Number(m[1]), cpu: Number(m[2]), comm: m[3] });
  }
  cache = { at: now, list };
  return list;
}

/** 按 comm 子串/正则汇总 CPU（纯函数，便于单测） */
export function sumByMatch(list, match) {
  const re = match instanceof RegExp ? match : null;
  let cpu = 0, procs = 0;
  for (const p of list || []) {
    if (re ? !re.test(p.comm) : !String(p.comm).includes(match)) continue;
    cpu += p.cpu;
    procs += 1;
  }
  return { cpu: Math.round(cpu * 10) / 10, procs };
}

/** 进程名精确匹配（等价 pgrep -x，取 comm 的 basename） */
export function hasProcess(list, name) {
  return (list || []).some((p) => String(p.comm).split("/").pop() === name);
}
