// src/routes/api-admin.js
import { 
  getOnboardAll, 
  deleteOnboardAll, 
  setOnboardStatus 
} from "../storage.js";

import { 
  splynxPUT, 
  splynxPOST, 
  mapEditsToSplynxPayload 
} from "../splynx.js";

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // --- Get all sessions ---
  if (path === "/api/admin/sessions" && method === "GET") {
    const rows = await getOnboardAll(env);
    return new Response(JSON.stringify(rows), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- Delete a session ---
  if (path === "/api/admin/delete" && method === "POST") {
    const { id } = await request.json();
    await deleteOnboardAll(env, id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- Set status (incl. approve with sync) ---
  if (path === "/api/admin/set-status" && method === "POST") {
    const { id, status } = await request.json();

    // 1) Update KV
    await setOnboardStatus(env, id, status);

    // 2) If approved → push to Splynx
    if (status === "approved") {
      const key = "onboard:" + id;
      const raw = await env.SESSION_KV.get(key);
      if (!raw) {
        return new Response(JSON.stringify({ ok: false, error: "Session not found" }), { 
          status: 404, 
          headers: { "content-type": "application/json" } 
        });
      }

      const session = JSON.parse(raw);

      try {
        // --- Build Splynx payload from session edits ---
        const payload = mapEditsToSplynxPayload(session);

        // --- Update customer/lead profile in Splynx ---
        if (session.customer_id) {
          await splynxPUT(env, `/admin/customers/${session.customer_id}`, payload);
        } else if (session.lead_id) {
          await splynxPUT(env, `/admin/crm/leads/${session.lead_id}`, payload);
        }

        // --- Upload supporting documents (if any) ---
        if (session.uploads && session.uploads.length > 0) {
          for (const file of session.uploads) {
            try {
              if (session.customer_id) {
                await splynxPOST(env, `/admin/customers/customer-documents`, {
                  customer_id: session.customer_id,
                  file: file.key,      // assumes file already uploaded to R2
                  description: file.type,
                });
              } else if (session.lead_id) {
                await splynxPOST(env, `/admin/crm/lead-documents`, {
                  lead_id: session.lead_id,
                  file: file.key,
                  description: file.type,
                });
              }
            } catch (uploadErr) {
              console.error("Doc upload failed:", uploadErr);
            }
          }
        }

        // --- Update KV session ---
        session.synced = true;
        session.status = "approved";
        await env.SESSION_KV.put(key, JSON.stringify(session));

        return new Response(JSON.stringify({ ok: true, synced: true }), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        console.error("Approve sync failed", err);
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404 });
}
