import { afterEach, expect, test, vi } from "vitest";
import { Ajv } from "ajv";
import transcriptSchema from "../../contracts/transcript-result.schema.json";
import logSchema from "../../contracts/log-event.schema.json";
import { log } from "../src/log";
import type { LogEventName } from "../src/contracts/log-events";

const ajv = new Ajv();
const validResult = ajv.compile(transcriptSchema);
const validLine = ajv.compile(logSchema);

const result = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.25,
  pages: ["a b c"],
};
const line = {
  ts: "2026-10-16T10:00:00.000Z",
  level: "info",
  service: "worker",
  event: "service.started",
  attrs: { version: "0.1.0" },
};

afterEach(() => vi.restoreAllMocks());

test("a valid transcript result is accepted", () => {
  expect(validResult(result)).toBe(true);
});

test.each([{ extra: 1 }, { video_id: "short" }, { status: "maybe" }, { word_count: -1 }])(
  "an invalid transcript result is rejected: %j",
  (change) => {
    expect(validResult({ ...result, ...change })).toBe(false);
  },
);

test("a valid log line is accepted", () => {
  expect(validLine(line)).toBe(true);
});

test.each([{ event: "nope" }, { extra: 1 }, { ts: "yesterday" }])(
  "an invalid log line is rejected: %j",
  (change) => {
    expect(validLine({ ...line, ...change })).toBe(false);
  },
);

test("log writes one line valid against the schema", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log("service.started", { attrs: { version: "0.1.0" } });
  expect(spy).toHaveBeenCalledTimes(1);
  const written = JSON.parse(String(spy.mock.calls[0]?.[0])) as { service: string };
  expect(validLine(written)).toBe(true);
  expect(written.service).toBe("worker");
});

test("log throws for an event outside the catalogue", () => {
  expect(() => log("not.catalogued" as LogEventName)).toThrow();
});

test("log throws for an unknown field", () => {
  expect(() => log("service.started", { bogus: 1 } as object)).toThrow();
});
