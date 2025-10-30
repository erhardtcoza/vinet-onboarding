// Entry point: host switch + delegate to modules

import { route as routeOnboarding } from "./routes.js"; // your existing onboarding router
import { handlePublic } from "./public/routes.js";
import { handleAdmin } from "./admin/routes.js";
import { hostOf } from "./utils/http.js";

export default {
  async fetch(request, env, ctx) {
    const host = hostOf(request);

    if (host === "new.vinet.co.za") {
      const r = await handlePublic(request, env, ctx);
      return r || new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    }

    if (host === "crm.vinet.co.za") {
      const r = await handleAdmin(request, env, ctx);
      return r || new Response("<h1>Admin route not handled</h1>", { status: 404, headers: { "content-type": "text/html" } });
    }

    if (host === "onboard.vinet.co.za") {
      return routeOnboarding(request, env, ctx);
    }

    return new Response("<h1>Host not configured</h1>", { status: 400, headers: { "content-type": "text/html" } });
  },
};
