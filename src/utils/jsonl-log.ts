import fs from "node:fs";
import path from "node:path";

function logsDir(): string {
  const dir = path.join(process.cwd(), "data", "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
  );
}

function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

export interface JsonlLogRecord {
  timestamp: string;
  event: string;
  [key: string]: unknown;
}

export function appendJsonlLog(fileName: string, event: string, payload: Record<string, unknown>): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...normalizePayload(payload),
  });
  fs.appendFileSync(path.join(logsDir(), fileName), `${entry}\n`, "utf-8");
}

export function readRecentJsonlLogs(fileName: string, limit: number | "all" = 20): JsonlLogRecord[] {
  const filePath = path.join(logsDir(), fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) {
    return [];
  }
  const allLines = content.split("\n").filter(Boolean);
  const lines = limit === "all"
    ? allLines
    : allLines.slice(-Math.max(1, limit));
  const records: JsonlLogRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as JsonlLogRecord);
    } catch {
      records.push({
        timestamp: new Date().toISOString(),
        event: "parse_error",
        raw: line,
      });
    }
  }
  return records;
}

export function clearJsonlLog(fileName: string): void {
  fs.writeFileSync(path.join(logsDir(), fileName), "", "utf-8");
}
