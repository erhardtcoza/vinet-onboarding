// src/routes/api-admin.js
import { getOnboardAll, deleteOnboardAll } from "../storage.js";

/**
 * Entry point: used by index.js
 */
export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const id = url.searchParams.get("id");

  if (path === "/api/admin/sessions" && request.method === "GET") {
    const all = await getOnboardAll(env);
    const inprogress = [];
    const pending = [];
    const approved = [];

    for (const row of all) {
      if (row.status === "inprogress") inprogress.push(row);
      else if (row.status === "pending") pending.push(row);
      else if (row.status === "approved") approved.push(row);
    }

    return new Response(JSON.stringify({ inprogress, pending, approved }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (path === "/api/admin/approve" && request.method === "POST") {
    if (!id) return new Response("Missing id", { status: 400 });
    const all = await getOnboardAll(env);
    const row = all.find(r => String(r.id) === String(id));
    if (!row) return new Response("Not found", { status: 404 });

    row.status = "approved";
    await env.SESSION_KV.put("onboard:" + row.id, JSON.stringify(row));
    return new Response(JSON.stringify({ ok: true }));
  }

  if (path === "/api/admin/delete" && request.method === "POST") {
    if (!id) return new Response("Missing id", { status: 400 });
    await deleteOnboardAll(env, id);
    return new Response(JSON.stringify({ ok: true }));
  }

  return new Response("Not found", { status: 404 });
}
