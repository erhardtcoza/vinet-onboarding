// src/branding.js

// ---------- IPv4 helpers ----------
function ipv4ToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const [a,b,c,d] = p.map((x) => Number(x));
  if ([a,b,c,d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((a<<24) >>> 0) + (b<<16) + (c<<8) + d;
}
function parseCidrV4(cidr) {
  const [ip, bitsStr] = String(cidr || "").trim().split("/");
  const base = ipv4ToInt(ip);
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (base == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return { base, mask, bits };
}
function ipInCidrV4(ip, parsed) {
  const ipInt = ipv4ToInt(ip);
  if (ipInt == null || !parsed) return false;
  return (ipInt & parsed.mask) === (parsed.base & parsed.mask);
}

// ---------- IPv6 helpers ----------
function expandIpv6(ip) {
  // Normalize shorthand like "2001:db8::1" to full 8 hextets
  const hasDbl = ip.includes("::");
  let head = "", tail = "";
  if (hasDbl) {
    const parts = ip.split("::");
    head = parts[0];
    tail = parts[1] || "";
  } else {
    head = ip;
  }
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  // Handle IPv4-embedded tail like ::ffff:192.0.2.1 (we won't support it here)
  if (headParts.some(p => p.includes(".")) || tailParts.some(p => p.includes("."))) return null;

  const missing = 8 - (headParts.filter(Boolean).length + tailParts.filter(Boolean).length);
  if (missing < 0) return null;

  const full = [
    ...headParts.filter(Boolean),
    ...Array(missing).fill("0"),
    ...tailParts.filter(Boolean),
  ];
  if (full.length !== 8) return null;
  return full.map(h => h || "0");
}
function ipv6ToBigInt(ip) {
  const parts = expandIpv6(ip);
  if (!parts) return null;
  let v = 0n;
  for (const h of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    v = (v << 16n) + BigInt(parseInt(h, 16));
  }
  return v;
}
function parseCidrV6(cidr) {
  const [ip, bitsStr] = String(cidr || "").trim();
  const base = ipv6ToBigInt(ip);
  const bits = bitsStr && bitsStr.includes("/") ? Number(bitsStr.split("/")[1]) : Number(bitsStr?.split("/")[1]);
  const prefix = bitsStr && bitsStr.includes("/") ? Number(bitsStr.split("/")[1]) : undefined;
  const b = (cidr.includes("/")) ? Number(cidr.split("/")[1]) : 128;
  if (base == null || !Number.isInteger(b) || b < 0 || b > 128) return null;

  const all = (1n << 128n) - 1n;
  const mask = b === 0 ? 0n : ((all << (128n - BigInt(b))) & all);
  return { base: (base & mask), mask, bits: b };
}
function ipInCidrV6(ip, parsed) {
  const v = ipv6ToBigInt(ip);
  if (v == null || !parsed) return false;
  return (v & parsed.mask) === parsed.base;
}

// ---------- Dispatcher ----------
function parseCidrAny(x) {
  const s = String(x || "").trim();
  // Single IP (no slash) -> treat as /32 (v4) or /128 (v6)
  if (!s.includes("/")) {
    if (s.includes(":")) return parseCidrV6(`${s}/128`);
    return parseCidrV4(`${s}/32`);
  }
  // CIDR
  if (s.includes(":")) return parseCidrV6(s);
  return parseCidrV4(s);
}
function ipInCidrAny(ip, parsed) {
  if (!parsed) return false;
  if (ip.includes(":")) return ipInCidrV6(ip, parsed);
  return ipInCidrV4(ip, parsed);
}

/**
 * Allowlist by IP/CIDR (IPv4 + IPv6).
 * - Always allow localhost (127.0.0.1 / ::1)
 * - Default allow: VNET 160.226.128.0/20
 * - Extra IPv4/IPv6 ranges via env.ALLOW_IP_CIDRS
 *
 * Examples for ALLOW_IP_CIDRS:
 *   "203.0.113.0/24, 2a09:bac5::/32, 2a09:bac5:d4d2:46e::71:40/128"
 */
export function ipAllowed(request, env = {}) {
  // CF provides the real client IP here:
  let ip = request.headers.get("CF-Connecting-IP")
        || request.headers.get("x-forwarded-for")
        || request.headers.get("x-real-ip")
        || "";

  // If X-Forwarded-For is a list, take the first
  if (ip.includes(",")) ip = ip.split(",")[0].trim();

  // Local dev
  if (ip === "127.0.0.1" || ip === "::1") return true;

  // Default VNET IPv4 block
  const defaults = ["160.226.128.0/20"];

  // Extra ranges from env (IPv4 and/or IPv6)
  const extra =
    String(env?.ALLOW_IP_CIDRS || "")
      .split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const allCidrs = [...defaults, ...extra]
    .map(parseCidrAny)
    .filter(Boolean);

  // Only allow valid v4/v6 literals
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  const isIPv6 = ip.includes(":");
  if (!isIPv4 && !isIPv6) return false;

  for (const parsed of allCidrs) {
    if (ipInCidrAny(ip, parsed)) return true;
  }
  return false;
}