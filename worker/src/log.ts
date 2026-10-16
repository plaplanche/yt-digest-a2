import type { EventName, LogEvent } from "./contracts/log-event";

const EVENTS = [
  "service.started",
  "fetch.transcript",
  "sponsorblock.call",
  "node.enrolled",
  "node.revoked",
  "node.heartbeat",
  "job.enqueued",
  "job.claimed",
  "job.completed",
  "job.released",
  "job.lease_expired",
  "job.stale_result",
  "job.validation_failed",
  "auth.bearer.rejected",
  "auth.client.registered",
  "auth.oauth.completed",
  "auth.oauth.denied",
  "auth.token.issued",
  "auth.refresh.reuse_detected",
  "auth.origin.rejected",
  "mcp.tool.call",
  "worker.call",
] as const satisfies readonly EventName[];
// Fails to compile when the catalogue gains an event that EVENTS does not list.
const _exhaustive: Exclude<EventName, (typeof EVENTS)[number]> extends never ? true : never = true;
void _exhaustive;

const FIELDS = ["request_id", "video_id", "attrs"];

export type LogFields = Partial<Pick<LogEvent, "request_id" | "video_id" | "attrs">>;

export function log(event: EventName, fields: LogFields = {}, level: LogEvent["level"] = "info"): void {
  if (!(EVENTS as readonly string[]).includes(event)) {
    throw new Error(`unknown log event: ${String(event)}`);
  }
  const unknown = Object.keys(fields).filter((k) => !FIELDS.includes(k));
  if (unknown.length > 0) {
    throw new Error(`unknown log field(s): ${unknown.join(", ")}`);
  }
  const line: LogEvent = { ts: new Date().toISOString(), level, service: "worker", event, attrs: {}, ...fields };
  console.error(JSON.stringify(line));
}
