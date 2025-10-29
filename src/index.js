import { route } from "./routes.js";

export default {
  async fetch(request, env, ctx) {
    try { return await route(request, env); }
    catch (e) {
      const msg = (e && e.stack) ? e.stack : String(e);
      return new Response(`Internal Error\n\n${msg}`, { status: 500, headers:{ "content-type":"text/plain" } });
    }
  }
};
