import pkg from "../package.json";
import type { Env } from "./env";
import { json, notFound } from "./http";
import { handleOps } from "./ops";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET") return json({ status: "ok", version: pkg.version });
    if (pathname === "/ops" || pathname.startsWith("/ops/")) return handleOps(request, env, pathname);
    return notFound();
  },
};
