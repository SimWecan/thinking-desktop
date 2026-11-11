/**
 * index.mjs — 进程入口（瘦）：解析端口与工作目录，交给组合根 app.mjs。
 * 业务逻辑一律不许进这个文件。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./app.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.THINKING_DESKTOP_PORT) || 7799;

start({ root, port });
