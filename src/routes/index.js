// src/routes/index.js

import { handleSplynxApi } from "./splynx.js";

export async function route(request, env) {
  const url = new URL(request.url);

  // --- ADMIN ROUTES ---

  // Generate onboarding link
  if (url.pathname === "/api/admin/genlink" && request.method === "POST") {
    try {
      const data = await request.json();
      const id = data.id;
      if (!id) {
        return new Response(JSON.stringify({ error: "missing id" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const rand = Math.random().toString(36).substring(2, 8);
      const token = `${id}_${rand}`;

      await env.SESSION_KV.put(
        `onboard:${token}`,
        JSON.stringify({ id, status: "in_progress" }),
        { expirationTtl: 86400 }
      );

      const link = `https://onboard.vinet.co.za/${token}`;

      return new Response(JSON.stringify({ link }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "genlink_failed", details: e.message }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // List sessions for admin dashboard
  if (url.pathname === "/api/admin/listlinks" && request.method === "GET") {
    try {
      const sessions = [];

      // --- In Progress from KV ---
      const list = await env.SESSION_KV.list({ prefix: "onboard:" });
      for (const key of list.keys) {
        const data = await env.SESSION_KV.get(key.name);
        if (data) {
          const parsed = JSON.parse(data);
          sessions.push({
            token: key.name.replace("onboard:", ""),
            status: parsed.status || "in_progress",
            id: parsed.id,
            source: "kv",
          });
        }
      }

      // --- Pending & Approved from D1 ---
      const { results } = await env.DB.prepare(
        "SELECT id, splynx_id, status, created_at FROM onboard_sessions ORDER BY created_at DESC"
      ).all();

      for (const row of results) {
        sessions.push({
          token: row.id,
          status: row.status,
          id: row.splynx_id,
          created_at: row.created_at,
          source: "db",
        });
      }

      return new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "listlinks_failed", details: e.message }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // --- SPLYNX ROUTES ---
  if (url.pathname.startsWith("/api/splynx/")) {
    return handleSplynxApi(request, env);
  }

  // --- FALLBACK ---
  return new Response("Not Found", { status: 404 });
}
