// /src/routes/public_leads.js
// Shim to avoid route duplication; keep legacy links working.
export function mount(router) {
  // Old GET /lead path just forwards to the real one
  router.add("GET", "/public/lead", () => Response.redirect("/lead", 302));

  // Old POST /submit forwards to the new queue endpoint
  router.add("POST", "/submit", async (req, env) => {
    const url = new URL(req.url);
    url.pathname = "/lead/submit";
    return fetch(new Request(url.toString(), { method: "POST", headers: req.headers, body: await req.blob() }), env);
  });
}
