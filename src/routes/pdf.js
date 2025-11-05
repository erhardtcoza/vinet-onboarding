// /src/routes/pdf.js
// Minimal PDFs for MSA / Debit using pdf-lib. Good enough to upload to Splynx.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function makeSimplePdf(title, sess) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (text, x, y, size=12) => page.drawText(String(text||""), { x, y, size, font, color: rgb(0.1,0.1,0.13) });

  draw(title, 50, 790, 18);
  draw("Name:", 50, 750);       draw(sess?.name || sess?.full_name || "", 140, 750);
  draw("Email:", 50, 730);      draw(sess?.email || "", 140, 730);
  draw("Phone:", 50, 710);      draw(sess?.phone || "", 140, 710);
  draw("Address:", 50, 690);    draw(`${sess?.street||""}, ${sess?.city||""}, ${sess?.zip||""}`, 140, 690);
  draw(`Generated: ${new Date().toISOString()}`, 50, 660, 10);

  return pdf.save();
}

export function mount(router) {
  router.add("GET", "/pdf/msa/:linkid", async (req, env) => {
    const linkid = req.params.linkid;
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Not found", { status: 404 });
    const bytes = await makeSimplePdf("Master Service Agreement", sess);
    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  });

  router.add("GET", "/pdf/debit/:linkid", async (req, env) => {
    const linkid = req.params.linkid;
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Not found", { status: 404 });
    const bytes = await makeSimplePdf("Debit Order Instruction", sess);
    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  });
}
