// /src/routes/self-signup.js
import { renderPublicLeadHTML } from "../ui/public_lead.js";

export function mount(router) {
  router.add("GET", "/self-signup", () =>
    new Response(renderPublicLeadHTML(), { headers: { "content-type": "text/html; charset=utf-8" } })
  );
  router.add("GET", "/self-signup/", () =>
    new Response(renderPublicLeadHTML(), { headers: { "content-type": "text/html; charset=utf-8" } })
  );
}
