export const json = (o, s = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...extraHeaders },
  });

export const html = (h, s = 200, extraHeaders = {}) =>
  new Response(h, {
    status: s,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });

export const safeStr = (v) => (v == null ? "" : String(v)).trim();

export const hostOf = (req) => new URL(req.url).host.toLowerCase();

export const hasCookie = (req, name, val) => {
  const c = req.headers.get("cookie") || "";
  const re = new RegExp(`(?:^|;\\s*)${name}=${val}(?:;|$)`);
  return re.test(c);
};
