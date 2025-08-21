// src/routes/api-splynx.js
import { splynxGET } from "../splynx.js";

export async function handleSplynxApi(request, env, url, path, method) {
  if (path !== "/api/profile" || method !== "POST") return null;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return new Response("Missing id", { status: 400 });

  const eps = [
    `/admin/crm/leads/${id}`,
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}/contacts`,
    `/admin/customers/${id}/contacts`,
  ];

  const profile = {};
  for (const ep of eps) {
    try {
      const res = await splynxGET(env, ep);
      if (Array.isArray(res)) continue;
      Object.assign(profile, res);
    } catch {}
  }

  const pick = (o, keys) =>
    Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

  const baseKeys = ["name", "email", "phone", "city", "street_1", "zip", "id_number"];
  const data = pick(profile, baseKeys);

  // Map id_number to passport for UI
  if (data.id_number) {
    data.passport = data.id_number;
    delete data.id_number;
  }

  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}
