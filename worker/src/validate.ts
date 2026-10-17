import { errorResponse } from "./http";

export type Fields = Record<string, unknown>;

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const invalidRequest = (message: string): Response => errorResponse(400, "invalid_request", message);

// Parses the body as a JSON object; a Response is the 400 to answer.
export async function readObject(request: Request): Promise<Fields | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalidRequest("Body must be a JSON object");
  return body as Fields;
}

// Describes the first problem of an object against a small field table, or null when it conforms.
export function check(body: Fields, allowed: Record<string, (v: unknown) => boolean>, required: string[]): string | null {
  for (const key of Object.keys(body)) if (!(key in allowed)) return `Unknown field ${key}`;
  for (const key of required) if (!(key in body)) return `Missing field ${key}`;
  for (const [key, valid] of Object.entries(allowed)) if (key in body && !valid(body[key])) return `Invalid field ${key}`;
  return null;
}

export const isInt = (min: number, max = Infinity) => (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
export const isString = (min: number, max = Infinity) => (v: unknown): boolean =>
  typeof v === "string" && v.length >= min && v.length <= max;
export const isTimestampOrNull = (v: unknown): boolean => v === null || (typeof v === "string" && TIMESTAMP.test(v));
export const isNumber = (min = -Infinity, max = Infinity) => (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
