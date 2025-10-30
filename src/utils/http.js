export const json = (o, s = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...extra } });

export const html = (h, s = 200, extra = {}) =>
  new Response(h, { status: s, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

export const safeStr = (v) => (v == null ? "" : String(v)).trim();
export const hostOf = (req) => new URL(req.url).host.toLowerCase();

export const getCookie = (req, name) => {
  const h = req.headers.get("cookie") || "";
  const m = h.match(new RegExp("(^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
};

export const hasCookie = (req, name, val = undefined) => {
  const c = getCookie(req, name);
  return val === undefined ? !!c : c === String(val);
};
