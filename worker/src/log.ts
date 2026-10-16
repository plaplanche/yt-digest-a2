import { LOG_EVENTS, type LogEventName } from "./contracts/log-events";
import type { LogEvent } from "./contracts/log-event";

export type LogFields = Partial<Pick<LogEvent, "level" | "request_id" | "video_id" | "attrs">>;

const FIELDS = ["level", "request_id", "video_id", "attrs"];
const LEVELS = ["debug", "info", "warn", "error"];

/** Writes one JSON log line; throws for an event or field outside the contract. */
export function log(event: LogEventName, fields: LogFields = {}): void {
  if (!(LOG_EVENTS as readonly string[]).includes(event)) {
    throw new Error(`unknown log event: ${String(event)}`);
  }
  for (const key of Object.keys(fields)) {
    if (!FIELDS.includes(key)) throw new Error(`unknown log field: ${key}`);
  }
  const level = fields.level ?? "info";
  if (!LEVELS.includes(level)) throw new Error(`unknown log level: ${level}`);
  const record: LogEvent = {
    ts: new Date().toISOString(),
    service: "worker",
    event,
    attrs: {},
    ...fields,
    level,
  };
  console.log(JSON.stringify(record));
}
