// src/routes/public.js
import { ipAllowed } from "../branding.js";
import { renderAdminPage } from "../ui/admin.js";

const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";

export function match(path, method) {
  if (path === "/" && method === "GET") return true;
  if (path === "/info/eft" && method === "GET") return true;
  return false;
}

export async function handle(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Admin dashboard
  if (path === "/") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // EFT info page
  if (path === "/info/eft") {
    const id = url.searchParams.get("id") || "";
    const escapeHtml = (s) =>
      String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>body{font-family:Arial,sans-serif;background:#f7f7fa}.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}h1{color:#e2001a;font-size:34px;margin:8px 0 18px}.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}.grid .full{grid-column:1 / -1}label{font-weight:700;color:#333;font-size:14px}input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(
      id || ""
    )}"></div>
  </div>
  <p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;

    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return new Response("Not found", { status: 404 });
}
