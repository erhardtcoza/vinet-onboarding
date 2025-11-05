// /src/routes/api-onboard.js
export function mount(router) {
  router.add("POST", "/api/onboard/create", async (req) => {
    const body = await req.json().catch(() => ({}));
    const name = String((body.name || "").trim() || "client");
    const parts = name.split(/\s+/).filter(Boolean);
    const base = (parts.length ? parts[parts.length - 1] : name).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    const code = `${base || "client"}_${rand}`;
    const url = `https://onboard.vinet.co.za/onboard/${code}`;
    return new Response(JSON.stringify({ code, url }), {
      headers: { "content-type": "application/json" },
    });
  });
}
