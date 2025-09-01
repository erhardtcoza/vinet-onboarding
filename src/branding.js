// src/branding.js

// Small IPv4 helpers
function ipv4ToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const [a,b,c,d] = p.map((x) => Number(x));
  if ([a,b,c,d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((a<<24) >>> 0) + (b<<16) + (c<<8) + d;
}

function parseCidr(cidr) {
  // "A.B.C.D/n"
  const [ip, bitsStr] = String(cidr || "").trim().split("/");
  const bits = Number(bitsStr);
  const base = ipv4ToInt(ip);
  if (base == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return { base: base & mask, mask };
}

function ipInCidr(ip, cidr) {
  const ipInt = ipv4ToInt(ip);
  const parsed = parseCidr(cidr);
  if (ipInt == null || !parsed) return false;
  return (ipInt & parsed.mask) === parsed.base;
}

/**
 * Allowlist by IP/CIDR.
 * - Always allow localhost (127.0.0.1 / ::1)
 * - Default allow: VNET 160.226.128.0/20
 * - Extra ranges can be provided via env.ALLOW_IP_CIDRS as a comma/space-separated list,
 *   e.g. "203.0.113.0/24, 198.51.100.0/24"
 *
 * Tip: If you want to include Cloudflare WARP egress IPs, put them in ALLOW_IP_CIDRS.
 * (Cloudflare can rotate egress ranges, so keeping them in an env var is safer.)
 */
export function ipAllowed(request, env = {}) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";

  // Local dev
  if (ip === "127.0.0.1" || ip === "::1") return true;

  // Default VNET range
  const defaults = ["160.226.128.0/20"]; // (128..143)

  // Extra ranges from env
  const extra =
    String(env?.ALLOW_IP_CIDRS || "")
      .split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const allCidrs = [...defaults, ...extra];

  // Only handle IPv4 here. If IPv6 needed later, we can extend.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;

  for (const cidr of allCidrs) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}