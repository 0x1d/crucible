// Import this module first: it sends console output to a log file so that it
// does not write over the TUI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";

export const logFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.alchemist/tui/tui.log",
);
fs.mkdirSync(path.dirname(logFile), { recursive: true });

const write =
  (level: string) =>
  (...args: unknown[]): void => {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${format(...args)}\n`);
  };

console.log = write("log");
console.info = write("info");
console.debug = write("debug");
console.warn = write("warn");
console.error = write("error");
