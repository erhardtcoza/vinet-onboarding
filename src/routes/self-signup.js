// /src/routes/self-signup.js
// Convenience wrapper if anything still imports this file.
// It simply mounts the same UI as / (root) & /lead.
import { renderPublicLeadHTML } from "../ui/public_lead.js";

export function mount(router) {
  router.add("GET", "/self-signup", () =>
    new Response(renderPublicLeadHTML(), { headers: { "content-type": "text/html; charset=utf-8" } })
  );
}
