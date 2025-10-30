// src/index.js
import { route as routeOnboarding } from "./routes.js"; // your existing onboarding app
import { handleAdmin } from "./admin/routes.js";
import { handlePublic } from "./public/routes.js"; // the splash/form + Turnstile module
import { html } from "./utils/http.js";

const hostOf = (req) => new URL(req.url).host.toLowerCase();

export default {
  async fetch(request, env, ctx) {
    const host = hostOf(request);

    if (host === "new.vinet.co.za") {
      const r = await handlePublic(request, env, ctx);
      if (r) return r;
      return html("<h1>Not found</h1>", 404);
    }

    if (host === "crm.vinet.co.za") {
      const r = await handleAdmin(request, env, ctx);
      if (r) return r;
      return html("<h1>Admin route not handled</h1>", 404);
    }

    if (host === "onboard.vinet.co.za") {
      return routeOnboarding(request, env, ctx);
    }

    return html("<h1>Host not configured</h1>", 400);
  },
};
