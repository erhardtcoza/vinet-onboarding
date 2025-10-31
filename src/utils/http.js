// src/utils/http.js
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".pdf":  "application/pdf"
};

function extOf(pathname="") {
  const i = pathname.lastIndexOf(".");
  return i >= 0 ? pathname.slice(i).toLowerCase() : "";
}

export function html(body, init={}) {
  const h = new Headers(init.headers || {});
  h.set("content-type", TYPES[".html"]);
  h.delete("content-disposition");
  return new Response(body, { ...init, headers: h });
}

export function js(body, init={}) {
  const h = new Headers(init.headers || {});
  h.set("content-type", TYPES[".js"]);
  h.delete("content-disposition");
  return new Response(body, { ...init, headers: h });
}

export function css(body, init={}) {
  const h = new Headers(init.headers || {});
  h.set("content-type", TYPES[".css"]);
  h.delete("content-disposition");
  return new Response(body, { ...init, headers: h });
}

export function json(data, init={}) {
  const h = new Headers(init.headers || {});
  h.set("content-type", TYPES[".json"]);
  h.delete("content-disposition");
  return new Response(JSON.stringify(data), { ...init, headers: h });
}

export function file(body, pathname, init={}) {
  const h = new Headers(init.headers || {});
  h.set("content-type", TYPES[extOf(pathname)] || "application/octet-stream");
  // only set attachment yourself if you *really* want downloads:
  // h.set("content-disposition", `inline; filename="${pathname.split('/').pop()}"`);
  return new Response(body, { ...init, headers: h });
}
