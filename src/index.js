// /src/index.js
import { Router } from "./router.js";
import { mount as mountPublic } from "./routes/public.js";
import { mount as mountAdmin } from "./routes/admin.js";
import { mount as mountCRM } from "./routes/crm_leads.js";

export default {
  async fetch(request, env, ctx) {
    const router = new Router();

    // mount route groups
    mountPublic(router);
    mountAdmin(router);
    mountCRM(router);

    // fallback default route
    router.add("GET", "/ok", () => new Response("OK"));

    // dispatch
    const res = await router.route(request, env, ctx);
    return res || new Response("Not Found", { status: 404 });
  },
};
