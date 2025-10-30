const SPYLNX_URL = "https://splynx.vinet.co.za";
const AUTH_HEADER =
  "Basic NTcxMDRhNGJjNjhhY2Y2MjRkMDliMmYwOTQ1ZTI1M2E6N2UyOTNmY2QyNzBjODJmOTdjNWQzODUwZjdhM2I1MTE=";

export async function splynx(method, path, body) {
  // path should start with "/api/2.0/..."
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method,
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
