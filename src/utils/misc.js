// src/utils/misc.js
export const DATE_TODAY = () => new Date().toISOString().slice(0, 10);
export const nowSec = () => Math.floor(Date.now() / 1000);

export function isAllowedIP(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  // 160.226.128.0/20
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

export function normalizeMsisdn(s) {
  let t = String(s || "").trim();
  if (t.startsWith("0")) t = "27" + t.slice(1);
  if (t.startsWith("+")) t = t.slice(1);
  return t.replace(/\D+/g, "");
}

export function hasTsCookie(req) {
  const c = req.headers.get("cookie") || "";
  return /(?:^|;\s*)ts_ok=1(?:;|$)/.test(c);
}
