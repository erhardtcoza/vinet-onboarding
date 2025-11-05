// /src/routes/turnstile.js
import { json } from "../utils/http.js";

function setCookie(headers, name, value, maxAge = 1800) {
  headers.append("Set-Cookie",
    `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`);
}

export function mountTurnstile(router) {
  router.add("POST", "/ts-verify", async (req, env) => {
    const { token, skip } = await req.json().catch(() => ({}));
    const headers = new Headers({ "content-type": "application/json" });

    // Mark that user has seen the check
    setCookie(headers, "ts_seen", "1", 3600);

    if (skip) {
      // allow continue but not secured
      return new Response(JSON.stringify({ ok: true, secured: false }), { headers });
    }

    try {
      const form = new URLSearchParams();
      form.set("secret", env.TURNSTILE_SECRET);
      form.set("response", token || "");
      form.set("remoteip", req.headers.get("CF-Connecting-IP") || "");

      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: form,
      });
      const data = await r.json();

      if (data?.success) {
        setCookie(headers, "ts_ok", "1", 1800); // 30 mins
        return new Response(JSON.stringify({ ok: true, secured: true }), { headers });
      }
    } catch {}

    return new Response(JSON.stringify({ ok: false, secured: false }), {
      status: 200, headers
    });
  });
}
