// src/splynx.js
// Shim that re-exports the new utils and adds the upload helper expected by routes.
import { SPYLNX_URL, AUTH_HEADER } from "./constants.js";

// Re-export everything from the new utils module so existing imports keep working.
export {
  splynxGET,
  splynxPOST,
  splynxPUT,
  splynxFetchLeads,
  splynxFetchCustomers,
  findCandidates,
  buildLeadPayload,
  createLead,
  updateLead,
  findReuseLead,
  listLeads,
  updateLeadFields,
  bulkSanitizeLeads,
} from "./utils/splynx.js";

/**
 * Create-and-upload helper expected by admin routes.
 * targetType: "lead" | "customer"
 * targetId:   numeric/string id
 * filename:   "doc.pdf" (optional)
 * bytes:      ArrayBuffer | Uint8Array | Blob
 * contentType:"application/pdf" (optional)
 */
export async function splynxCreateAndUpload(
  targetType,
  targetId,
  filename = "upload.bin",
  bytes,
  contentType = "application/octet-stream"
) {
  const endpoint =
    String(targetType).toLowerCase() === "lead"
      ? "/api/2.0/admin/crm/lead-documents"
      : "/api/2.0/admin/customers/customer-documents";

  // Accept Blob, ArrayBuffer, or Uint8Array
  const blob =
    bytes instanceof Blob ? bytes : new Blob([bytes], { type: contentType });

  const fd = new FormData();
  if (String(targetType).toLowerCase() === "lead") {
    fd.set("lead_id", String(targetId));
  } else {
    fd.set("customer_id", String(targetId));
  }
  fd.set("file", blob, filename);

  const r = await fetch(`${SPYLNX_URL}${endpoint}`, {
    method: "POST",
    headers: { Authorization: AUTH_HEADER }, // Let the browser set multipart boundary
    body: fd,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx upload ${endpoint} -> ${r.status} ${t}`);
  }
  // Some endpoints return {}, some return JSON object; be tolerant.
  try { return await r.json(); } catch { return { ok: true }; }
}
