import { PDFDocument, rgb } from "pdf-lib";
import { LOGO_URL, PDF_CACHE_TTL, VINET_BLACK } from "./constants.js";
export const escapeHtml = (s) =>
  String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
export { VINET_BLACK } from "./constants.js";
export function localDateZAISO(ts=Date.now()) {
  // YYYY-MM-DD in Africa/Johannesburg
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year:"numeric", month:"2-digit", day:"2-digit" });
  const [{value:y},{value:_},{value:m},{value:_2},{value:d}] = fmt.formatToParts(ts);
  return `${y}-${m}-${d}`;
}
export function localDateTimePrettyZA(ts=Date.now()) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone:"Africa/Johannesburg",
    year:"numeric", month:"short", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit"
  }).format(ts);
}

export function djb2(str) {
  let h=5381; for (let i=0;i<str.length;i++) h=((h<<5)+h)^str.charCodeAt(i);
  return (h>>>0).toString(36);
}

export async function fetchTextCached(url, env, cachePrefix="terms") {
  const key = `${cachePrefix}:${btoa(url).slice(0,40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, { cf:{ cacheEverything:true, cacheTtl:600 } });
    if (!r.ok) return "";
    const t = await r.text();
    await env.ONBOARD_KV.put(key, t, { expirationTtl: PDF_CACHE_TTL });
    return t;
  } catch { return ""; }
}

export async function getCachedJson(env, key) {
  const t = await env.ONBOARD_KV.get(key);
  return t ? JSON.parse(t) : null;
}
export async function setCachedJson(env, key, obj, ttl=PDF_CACHE_TTL) {
  await env.ONBOARD_KV.put(key, JSON.stringify(obj), { expirationTtl: ttl });
}

export async function getLogoBytes(env) {
  const kvKey = "asset:logoBytes:v3";
  const hit = await env.ONBOARD_KV.get(kvKey, "arrayBuffer");
  if (hit) return hit;
  const r = await fetch(LOGO_URL, { cf:{ cacheEverything:true, cacheTtl:3600 } });
  if (!r.ok) return null;
  const bytes = await r.arrayBuffer();
  await env.ONBOARD_KV.put(kvKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return bytes;
}
export async function embedLogo(pdf, env) {
  const bytes = await getLogoBytes(env);
  if (!bytes) return null;
  try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
}

export function wrapToLines(text, font, size, maxWidth) {
  const words = String(text||"").replace(/\s+/g," ").trim().split(" ");
  const lines=[]; let line="";
  for (const w of words) {
    const test = line ? line+" "+w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let buf=""; for (const ch of w) {
          const t2 = buf+ch;
          if (font.widthOfTextAtSize(t2, size) > maxWidth) { if (buf) lines.push(buf); buf=ch; } else buf=t2;
        } line=buf;
      } else line=w;
    } else line=test;
  }
  if (line) lines.push(line);
  return lines;
}
export async function getWrappedLinesCached(env, text, font, size, maxWidth, tag) {
  const key = `wrap:${tag}:${size}:${Math.round(maxWidth)}:${djb2(text)}`;
  const cached = await getCachedJson(env, key);
  if (cached) return cached;
  const lines = wrapToLines(text, font, size, maxWidth);
  await setCachedJson(env, key, lines);
  return lines;
}

export async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch { return null; }
}

export function drawDashedLine(page, x1, y, x2, opts={}) {
  const dash = opts.dash ?? 12;
  const gap = opts.gap ?? 7;
  const color = opts.color ?? VINET_BLACK;
  let x=x1; const dir = x2 >= x1 ? 1 : -1;
  while ((dir>0 && x < x2) || (dir<0 && x > x2)) {
    const xEnd = Math.min(x + dash*dir, x2);
    page.drawLine({ start:{x,y}, end:{x:xEnd,y}, thickness:1, color });
    x = xEnd + gap*dir;
  }
}

export function getClientMeta(request) {
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("user-agent") || "";
  return {
    ip, ua,
    asn: cf.asn || null,
    asOrganization: cf.asOrganization || null,
    city: cf.city || null,
    region: cf.region || null,
    country: cf.country || null,
    tz: "Africa/Johannesburg",
    at: Date.now(),
  };
}
// ---- Turnstile helpers ----
async function verifyTurnstileToken(secret, token, ip) {
  // https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!r.ok) throw new Error(`turnstile verify http ${r.status}`);
  const data = await r.json();
  return !!data.success;
}

async function markHumanOK(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return false;
  await env.ONBOARD_KV.put(
    `onboard/${linkid}`,
    JSON.stringify({ ...sess, ts_ok: true, ts_at: Date.now() }),
    { expirationTtl: 86400 }
  );
  return true;
}

async function isHuman(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  return !!(sess && sess.ts_ok === true);
}

function humanRequiredResponse() {
  return new Response(JSON.stringify({ ok: false, error: "human-check-required" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
