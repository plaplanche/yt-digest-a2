import { afterEach, expect, it, vi } from "vitest";
import { log } from "../src/log";

afterEach(() => vi.restoreAllMocks());

it("writes one valid JSON line", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  log("service.started", { attrs: { version: "0.1.0" }, request_id: "r1" });
  expect(spy).toHaveBeenCalledTimes(1);
  const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
  expect(line).toMatchObject({ event: "service.started", level: "info", service: "worker", request_id: "r1", attrs: { version: "0.1.0" } });
  expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

it("throws on an event outside the catalogue", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  // @ts-expect-error the type system rejects it too
  expect(() => log("not.catalogued")).toThrow();
  expect(spy).not.toHaveBeenCalled();
});

it("throws on an unknown field", () => {
  // @ts-expect-error the type system rejects it too
  expect(() => log("service.started", { bogus: 1 })).toThrow();
});
