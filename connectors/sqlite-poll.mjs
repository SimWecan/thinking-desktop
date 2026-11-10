/**
 * SQLite 轮询连接器：定期查询只增日志表，新行映射为事件。
 * 适用于 Codex (logs_2.sqlite) 等以 sqlite/WAL 落盘的 AI 软件。
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { Connector } from "./base.mjs";

export class SqlitePollConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source    来源标识
   * @param {string} opts.path      sqlite 文件路径
   * @param {string} opts.table     表名（需有自增 id 列）
   * @param {(row: object) => string|null} opts.mapType  行 → 事件类型；null 表示忽略
   * @param {(row: object) => object} [opts.payload]     行 → payload
   * @param {number} [opts.intervalMs]  轮询间隔，默认 2000
   * @param {number} [opts.maxBatch]    每轮最多上报条数，默认 20
   */
  constructor({ source, path, table, mapType, payload, intervalMs = 2000, maxBatch = 20 }) {
    super(source, "sqlite");
    this.path = path;
    this.table = table;
    this.mapType = mapType;
    this.payloadFn = payload ?? (() => ({}));
    this.intervalMs = intervalMs;
    this.maxBatch = maxBatch;
    this._lastId = 0;
  }

  start() {
    if (!existsSync(this.path)) {
      console.warn(`[${this.source}] db not found: ${this.path}`);
      return;
    }
    // 从最新位置开始，避免把历史日志全部 replay
    const db = new DatabaseSync(this.path, { readOnly: true });
    const r = db.prepare(`SELECT MAX(id) AS m FROM ${this.table}`).get();
    this._lastId = r?.m ?? 0;
    db.close();

    setInterval(() => this._poll(), this.intervalMs);
    console.log(`[${this.source}] polling ${this.path} (from id=${this._lastId})`);
  }

  _poll() {
    let db;
    try {
      db = new DatabaseSync(this.path, { readOnly: true });
      const rows = db
        .prepare(`SELECT * FROM ${this.table} WHERE id > ? ORDER BY id LIMIT ?`)
        .all(this._lastId, this.maxBatch);
      for (const row of rows) {
        this._lastId = Math.max(this._lastId, row.id);
        const type = this.mapType(row);
        if (type) this.emit({ type, payload: this.payloadFn(row) });
      }
    } catch (err) {
      if (!String(err.message).includes("busy")) {
        console.warn(`[${this.source}] poll error: ${err.message}`);
      }
    } finally {
      try { db?.close(); } catch {}
    }
  }
}
