// Splynx helpers + matching + create/overwrite
const SPYLNX_URL = "https://splynx.vinet.co.za";
const AUTH_HEADER =
  "Basic NTcxMDRhNGJjNjhhY2Y2MjRkMDliMmYwOTQ1ZTI1M2E6N2UyOTNmY2QyNzBjODJmOTdjNWQzODUwZjdhM2I1MTE=";

// Get leads list (simple; filter client-side)
async function fetchAllLeads() {
  const r = await fetch(`${SPYLNX_URL}/api/2.0/admin/crm/leads`, {
    headers: { Authorization: AUTH_HEADER }
  });
  if (!r.ok) throw new Error(`Splynx ${r.status}`);
  return r.json();
}

export async function matchAndUpsertLead(env, payload, { onlyMatch=false } = {}) {
  try {
    const all = await fetchAllLeads();
    const email = (payload.email||"").toLowerCase();
    const phone = (payload.phone||"").trim();
    const name  = (payload.name ||"").toLowerCase();

    const candidates = (Array.isArray(all) ? all : []).filter(l => {
      const le = (l.email||"").toLowerCase();
      const lp = (l.phone||"").trim();
      const ln = (l.name ||"").toLowerCase();
      return (
        (email && le === email) ||
        (phone && lp === phone) ||
        (name && (ln === name || ln.includes(name) || name.includes(ln)))
      );
    }).slice(0, 20).map(l => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      status: l.status
    }));

    if (onlyMatch) return { candidates };
    return { candidates };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function splynxCreateOrOverwrite(env, p, mode, targetId) {
  try {
    const headers = { Authorization: AUTH_HEADER, "content-type":"application/json" };
    const leadPayload = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      city: p.city,
      street_1: p.street,
      zip_code: p.zip,
      source: p.source,
      billing_email: p.email,
      score: 1,
      status: "New enquiry",
      date_add: (new Date()).toISOString().slice(0,10),
      owner: "public"
    };

    let url = `${SPYLNX_URL}/api/2.0/admin/crm/leads`;
    let method = "POST";

    if (mode === "overwrite" && targetId) {
      url = `${SPYLNX_URL}/api/2.0/admin/crm/leads/${targetId}`;
      method = "PUT";
    }

    const resp = await fetch(url, { method, headers, body: JSON.stringify(leadPayload) });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=> "");
      return { error: txt || `Splynx ${resp.status}` };
    }
    let created = null;
    try { created = await resp.json(); } catch {}
    const resultId = (created && created.id) || targetId || null;
    return { resultId };
  } catch (e) {
    return { error:String(e) };
  }
}
