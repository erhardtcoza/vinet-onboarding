// src/routes/api-splynx.js
export function match(path, method) {
  return path.startsWith("/api/splynx/");
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // raw passthrough → /api/splynx/raw?ep=/admin/crm/leads/3733
  if (path === "/api/splynx/raw") {
    const ep = url.searchParams.get("ep");
    if (!ep) {
      return new Response(JSON.stringify({ error: "Missing ep param" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const r = await fetch(`${env.SPLYNX_API_URL}${ep}`, {
      headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }

  // profile fetch → /api/splynx/profile?id=319
  if (path === "/api/splynx/profile") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id param" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const endpoints = [
      `/admin/customers/customer/${id}`,
      `/admin/customers/${id}`,
      `/admin/crm/leads/${id}`,
      `/admin/customers/${id}/contacts`,
      `/admin/crm/leads/${id}/contacts`,
    ];

    for (const ep of endpoints) {
      const r = await fetch(`${env.SPLYNX_API_URL}${ep}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      });
      if (r.ok) {
        return new Response(r.body, { status: 200, headers: { "content-type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ error: "Not found in Splynx" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // default: not found
  return new Response("Not found", { status: 404 });
}
