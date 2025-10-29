// index.js (or index.js, whichever you currently deploy)
import { route } from "./src/router.js";

export default {
  fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
};
