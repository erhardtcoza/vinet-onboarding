// src/routes/api-splynx.js
// Minimal Splynx proxy helpers (no itty-router)

function match(path, method) {
  return path.startsWith("/api/splynx/");
}

async function handle(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  // Strip `/api/splynx` prefix
  const splynxPath = url.pathname.replace(/^\/api\/splynx/, "");

  if (!splynxPath) {
    return new Response("Missing Splynx path", { status: 400 });
  }

  const splynxUrl = `${env.SPLYNX_API_URL}${splynxPath}${url.search}`;

  const headers = {
    Authorization: `Basic ${env.SPLYNX_AUTH}`,
  };

  // Forward JSON if present
  let body = null;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await request.text();
    headers["Content-Type"] = "application/json";
  }

  // Proxy request to Splynx
  const res = await fetch(splynxUrl, { method, headers, body });
  const data = await res.text();

  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}

export { match, handle };
