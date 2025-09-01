// src/branding.js

// ---------------- IPv4 helpers ----------------
function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const [a, b, c, d] = parts.map((x) => Number(x));
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((a << 24) >>> 0) | (b << 16) | (c << 8) | d) >>> 0;
}
function parseCidrV4(cidr) {
  const [ip, prefixStr] = String(cidr || "").trim().split("/");
  const base = ipv4ToInt(ip);
  const bits = prefixStr === undefined || prefixStr === "" ? 32 : Number(prefixStr);
  if (base == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return { v: 4, base, mask, bits };
}
function ipInCidrV4(ip, parsed) {
  const x = ipv4ToInt(ip);
  if (x == null || !parsed) return false;
  return (x & parsed.mask) === (parsed.base & parsed.mask);
}

// ---------------- IPv6 helpers ----------------
function expandIpv6(ip) {
  // Expand shorthand like "2001:db8::1" to 8 hextets
  const hasDbl = ip.includes("::");
  let head = "", tail = "";
  if (hasDbl) {
    const parts = ip.split("::");
    head = parts[0] || "";
    tail = parts[1] || "";
  } else {
    head = ip;
  }
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];

  // Reject IPv4-embedded forms here (not needed for our allowlist use)
  if (headParts.some(p => p.includes(".")) || tailParts.some(p => p.includes("."))) return null;

  const needed = 8 - (headParts.filter(Boolean).length + tailParts.filter(Boolean).length);
  if (needed < 0) return null;

  const full = [
    ...headParts.filter(Boolean),
    ...Array(needed).fill("0"),
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
  const [ip, prefixStr] = String(cidr || "").trim().split("/");
  const baseVal = ipv6ToBigInt(ip);
  const bits = prefixStr === undefined || prefixStr === "" ? 128 : Number(prefixStr);
  if (baseVal == null || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;

  const all = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : ((all << (128n - BigInt(bits))) & all);
  const base = baseVal & mask; // normalize network address
  return { v: 6, base, mask, bits };
}
function ipInCidrV6(ip, parsed) {
  const v = ipv6ToBigInt(ip);
  if (v == null || !parsed) return false;
  // All operands are BigInt here
  return (v & parsed.mask) === parsed.base;
}

// ---------------- Dispatcher ----------------
function parseCidrAny(x) {
  const s = String(x || "").trim();
  if (!s) return null;
  if (!s.includes("/")) {
    // Single host -> /32 or /128
    return s.includes(":") ? parseCidrV6(`${s}/128`) : parseCidrV4(`${s}/32`);
  }
  return s.includes(":") ? parseCidrV6(s) : parseCidrV4(s);
}
function ipInCidrAny(ip, parsed) {
  if (!parsed) return false;
  return parsed.v === 6 ? ipInCidrV6(ip, parsed) : ipInCidrV4(ip, parsed);
}

/**
 * Allowlist by IP/CIDR (IPv4 + IPv6).
 * - Always allow 127.0.0.1 and ::1
 * - Default allow: VNET 160.226.128.0/20
 * - Extra ranges via env.ALLOW_IP_CIDRS (comma/space/newline-separated)
 *
 * Examples:
 *   ALLOW_IP_CIDRS="203.0.113.0/24, 2a09:bac5::/32, 2a09:bac5:d4d2:46e::71:40/128"
 */
export function ipAllowed(request, env = {}) {
  let ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";

  if (ip.includes(",")) ip = ip.split(",")[0].trim();

  // Local dev
  if (ip === "127.0.0.1" || ip === "::1") return true;

  const defaults = ["160.226.128.0/20"]; // VNET block

  const extra = String(env.ALLOW_IP_CIDRS || "")
    .split(/[, \n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const cidrs = [...defaults, ...extra]
    .map(parseCidrAny)
    .filter(Boolean);

  // Basic check: must look like IPv4 or IPv6
  const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  const isV6 = ip.includes(":");
  if (!isV4 && !isV6) return false;

  for (const c of cidrs) {
    if (ipInCidrAny(ip, c)) return true;
  }
  return false;
}