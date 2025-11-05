// /src/routes/onboard.js
import { renderOnboardUI } from "../ui/onboard.js";

export function mount(router) {
  // Onboarding link
  router.add("GET", "/onboard/:code", async (req, env) => {
    const code = req.params.code;
    const sess = await env.ONBOARD_KV.get(`onboard/${code}`, "json");
    if (!sess) return new Response("Link expired or invalid", { status: 404 });
    return new Response(renderOnboardUI(code), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
}
