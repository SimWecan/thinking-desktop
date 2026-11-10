/**
 * 通用文件尾随连接器：监听任意日志 / 会话文件，按行正则提取事件。
 * 适用于 Claude Code jsonl、Kimi CLI 日志、Codex 会话等一切文本落盘的 AI 软件。
 */

import { watch, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { Connector } from "./base.mjs";

export class FileTailConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source    来源标识
   * @param {string} opts.path      要尾随的文件路径
   * @param {Array<{pattern: RegExp, type: string, payload?: (m: RegExpMatchArray) => object}>} opts.rules
   */
  constructor({ source, path, rules }) {
    super(source, "file");
    this.path = path;
    this.rules = rules;
    this._offset = 0;
  }

  start() {
    if (!existsSync(this.path)) {
      console.warn(`[${this.source}] file not found, waiting: ${this.path}`);
    } else {
      this._offset = statSync(this.path).size; // 只跟踪新追加内容
    }

    watch(this.path, { persistent: false }, () => this._drain());
    console.log(`[${this.source}] tailing ${this.path}`);
  }

  _drain() {
    let fd;
    try {
      fd = openSync(this.path, "r");
      const size = statSync(this.path).size;
      if (size < this._offset) this._offset = 0; // 文件被截断/轮换
      const buf = Buffer.alloc(size - this._offset);
      readSync(fd, buf, 0, buf.length, this._offset);
      this._offset = size;
      const lines = buf.toString("utf8").split("\n");
      for (const line of lines) this._matchLine(line);
    } catch {
      /* 文件写入中短暂不可读，忽略 */
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  _matchLine(line) {
    for (const rule of this.rules) {
      const m = line.match(rule.pattern);
      if (m) {
        this.emit({
          type: rule.type,
          payload: rule.payload ? rule.payload(m) : { raw: line.slice(0, 200) },
        });
        return;
      }
    }
  }
}
