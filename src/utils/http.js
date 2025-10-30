// src/utils/http.js
export const json = (o, s = 200, extra = {}) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...extra },
  });

export const html = (h, s = 200, extra = {}) =>
  new Response(h, {
    status: s,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });
