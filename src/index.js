// /src/index.js
import { Router } from "./router.js";
import { mount as mountPublic } from "./routes/public.js";
import { mount as mountAdmin } from "./routes/admin.js"; // optional, keeps admin routes working

export default {
  async fetch(req, env, ctx) {
    const router = new Router();

    // Mount public and admin routes
    mountPublic(router, env, ctx);
    mountAdmin(router, env, ctx);

    // Handle request
    const res = await router.route(req, env, ctx);
    if (res) return res;

    return new Response("Not found", { status: 404 });
  },
};
