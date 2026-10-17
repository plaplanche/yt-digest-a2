import pkg from "../package.json";
import type { Env } from "./env";
import { json, notFound } from "./http";
import { handleNode } from "./node";
import { handleOauth } from "./oauth";
import { handleOps } from "./ops";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET") return json({ status: "ok", version: pkg.version });
    if (pathname === "/ops" || pathname.startsWith("/ops/")) return handleOps(request, env, pathname);
    if (pathname.startsWith("/node/")) return handleNode(request, env, pathname);
    return (await handleOauth(request, env, pathname)) ?? notFound();
  },
};
