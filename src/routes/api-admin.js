// src/routes/api-admin.js
import {
  fetchProfileForDisplay,
  mapEditsToSplynxPayload,
  splynxPUT,
  splynxPOST,
  splynxCreateAndUpload,
} from "../splynx.js";
import { deleteOnboardAll } from "../storage.js";

/**
 * Handles admin API routes
 */
export async function handleApiAdmin(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  // --- List sessions by status ---
  if (path === "/api/admin/list") {
    const status = url.searchParams.get("status") || "inprogress";
    const { results } = await env.DB.prepare(
      "SELECT * FROM onboard WHERE status = ? ORDER BY created_at DESC"
    )
      .bind(status)
      .all();
    return Response.json(results);
  }

  // --- Fetch a single profile ---
  if (path === "/api/admin/profile") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });

    const profile = await fetchProfileForDisplay(env, id);
    return Response.json(profile || {});
  }

  // --- Update profile fields ---
  if (path === "/api/admin/update" && req.method === "POST") {
    const body = await req.json();
    const id = body.id;
    if (!id) return new Response("Missing id", { status: 400 });

    const editableFields = [
      "full_name",
      "email",
      "billing_email",
      "phone",
      "passport",
      "address",
      "city",
      "zip",
      "payment_method",
      "bank_name",
      "bank_account",
      "bank_branch",
      "signed_ip",
      "signed_device",
      "signed_date",
    ];

    const updates = {};
    for (const f of editableFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(", ");
      const values = Object.values(updates);
      values.push(id);

      await env.DB.prepare(
        `UPDATE onboard SET ${sets} WHERE id = ?`
      ).bind(...values).run();
    }

    try {
      const payload = mapEditsToSplynxPayload(body);
      if (Object.keys(payload).length > 0) {
        await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
      }
    } catch (err) {
      console.error("Splynx sync failed", err);
    }

    return new Response("OK");
  }

  // --- Approve / Reject ---
  if (path === "/api/admin/status" && req.method === "POST") {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) return new Response("Missing id or status", { status: 400 });

    if (!["approved", "rejected"].includes(status)) {
      return new Response("Invalid status", { status: 400 });
    }

    await env.DB.prepare(
      "UPDATE onboard SET status = ? WHERE id = ?"
    ).bind(status, id).run();

    // 🔄 Auto-sync on approve
    if (status === "approved") {
      try {
        const row = await env.DB.prepare("SELECT * FROM onboard WHERE id = ?")
          .bind(id)
          .first();

        if (row) {
          // Map to payload
          const payload = mapEditsToSplynxPayload(row);

          // Update if existing customer, otherwise create as new lead
          let splynxResult;
          try {
            splynxResult = await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
          } catch (_) {
            splynxResult = await splynxPOST(env, `/admin/crm/leads`, payload);
          }

          // Attachments (if stored in R2/KV)
          if (row.id_doc_key) {
            const file = await env.R2_BUCKET.get(row.id_doc_key);
            if (file) {
              await splynxCreateAndUpload(env, "lead", splynxResult.id || id, file);
            }
          }
          if (row.poa_doc_key) {
            const file = await env.R2_BUCKET.get(row.poa_doc_key);
            if (file) {
              await splynxCreateAndUpload(env, "lead", splynxResult.id || id, file);
            }
          }
          if (row.msa_doc_key) {
            const file = await env.R2_BUCKET.get(row.msa_doc_key);
            if (file) {
              await splynxCreateAndUpload(env, "lead", splynxResult.id || id, file);
            }
          }
          if (row.debit_doc_key) {
            const file = await env.R2_BUCKET.get(row.debit_doc_key);
            if (file) {
              await splynxCreateAndUpload(env, "lead", splynxResult.id || id, file);
            }
          }
        }
      } catch (err) {
        console.error("Auto-sync failed", err);
      }
    }

    return Response.json({ id, status });
  }

  // --- Delete ---
  if (path === "/api/admin/delete" && req.method === "POST") {
    const body = await req.json();
    const id = body.id;
    if (!id) return new Response("Missing id", { status: 400 });

    await deleteOnboardAll(env, id);
    await env.DB.prepare("DELETE FROM onboard WHERE id = ?").bind(id).run();

    return new Response("Deleted");
  }

  return new Response("Not found", { status: 404 });
}
