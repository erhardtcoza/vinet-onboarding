// /src/routes/public_leads.js
// Back-compat only — forwards old paths to the new ones in public.js
export function mount(router) {
  // Old "/public/lead" → "/lead"
  router.add("GET", "/public/lead", () => Response.redirect("/lead", 302));

  // Old "/submit" → "/lead/submit"
  router.add("POST", "/submit", async (req, env) => {
    const u = new URL(req.url);
    u.pathname = "/lead/submit";
    const body = await req.blob();
    return fetch(new Request(u.toString(), { method: "POST", headers: req.headers, body }), env);
  });
}
