// Vinet Onboarding Worker – single-file build
// ------------------------------------------------------------

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const TERMS_SERVICE_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_URL   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
// Public base for your R2 bucket (no trailing slash)
const R2_PUBLIC_BASE_FALLBACK = "https://onboarding-uploads.vinethosting.org";

// Allow-list (CIDR: 160.226.128.0/20)
const ALLOWED_IPS = ["160.226.128.0/20"];

// -------------------- tiny utils --------------------
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[m]));
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });

function ipAllowed(request){
  const ip = request.headers.get("CF-Connecting-IP");
  if(!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

const getIP = req =>
  req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";

const getUA = req => req.headers.get("user-agent") || "";

// -------------------- Splynx helpers --------------------
async function splynxGET(env, endpoint){
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });
  if(!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

// pull msisdn from messy object
function pickPhone(obj){
  if(!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for(const v of direct) if(ok(v)) return String(v).trim();
  if(Array.isArray(obj)){
    for(const it of obj){ const m = pickPhone(it); if(m) return m; }
  } else if (typeof obj === "object"){
    for(const k of Object.keys(obj)){ const m = pickPhone(obj[k]); if(m) return m; }
  }
  return null;
}

async function fetchCustomerMsisdn(env, id){
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}/contacts`,
  ];
  for(const ep of eps){
    try{
      const data = await splynxGET(env, ep);
      const m = pickPhone(data);
      if(m) return m;
    }catch{}
  }
  return null;
}

async function fetchProfileForDisplay(env, id){
  let cust=null, lead=null, contacts=null;
  try{ cust = await splynxGET(env, `/admin/customers/customer/${id}`); }catch{}
  if(!cust){ try{ lead = await splynxGET(env, `/crm/leads/${id}`); }catch{} }
  try{ contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); }catch{}
  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });
  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    street: src.street || "",
    city: src.city || "",
    zip: src.zip_code || src.zip || "",
  };
}

// -------------------- HTML shells --------------------
function pageShell(title, inner) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { --red:#e2001a; --ink:#222; --muted:#666; --bg:#fafbfc; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,"Noto Sans",sans-serif}
  .card{background:#fff;max-width:980px;margin:24px auto;border-radius:18px;box-shadow:0 2px 12px #0002;padding:20px}
  .logo{display:block;margin:8px auto 8px;max-width:150px}
  @media (max-width:640px){ .card{margin:8px; padding:16px} .logo{max-width:120px}}
  h1,h2{color:var(--red);margin:.2em 0 .6em}
  input,select,textarea{width:100%;padding:.7em;border:1px solid #ddd;border-radius:10px;font-size:16px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row>*{flex:1 1 280px}
  .btn{background:var(--red);color:#fff;border:0;border-radius:14px;padding:.8em 2.2em;font-size:16px;cursor:pointer}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:14px;padding:.7em 1.6em}
  .btn-secondary{background:#eee;color:#222;border:0;border-radius:14px;padding:.6em 1.2em}
  .note{color:var(--muted);font-size:13px}
  .progressbar{height:8px;background:#eee;border-radius:999px;margin:10px 0 18px;overflow:hidden}
  .progress{height:100%;background:var(--red);transition:width .3s}
  .pill-wrap{display:flex;gap:10px;flex-wrap:wrap}
  .pill{border:2px solid var(--red);color:var(--red);padding:.55em 1.2em;border-radius:999px;cursor:pointer;user-select:none}
  .pill.active{background:var(--red);color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:12px;border:1px solid #ddd;border-radius:12px;background:#f9f9f9}
  canvas.signature{border:1px dashed #bbb;border-radius:12px;width:100%;height:180px;touch-action:none;background:#fff}
  input[type=checkbox]{transform:scale(1.35);margin-right:10px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
</style>
</head><body><div class="card"><img class="logo" src="${LOGO_URL}" alt="Vinet Logo">${inner}</div></body></html>`;
}

function adminHTML() {
  return pageShell("Admin", `
    <h1>Admin Dashboard</h1>
    <div class="pill-wrap" style="justify-content:center;margin-bottom:12px">
      <a class="pill" id="tab-gen">1) Generate onboarding link</a>
      <a class="pill" id="tab-staff">2) Generate staff verification code</a>
      <a class="pill active" id="tab-inprog">3) Pending (in progress)</a>
      <a class="pill" id="tab-await">4) Completed (awaiting approval)</a>
      <a class="pill" id="tab-approved">5) Approved</a>
    </div>
    <div id="content"></div>
    <script src="/static/admin.js"></script>
  `);
}

// Admin client JS (tabs + lists + delete)
function adminJS() {
  return `(()=> {
    const content = document.getElementById('content');
    const tabs = {
      gen: document.getElementById('tab-gen'),
      staff: document.getElementById('tab-staff'),
      inprog: document.getElementById('tab-inprog'),
      await: document.getElementById('tab-await'),
      approved: document.getElementById('tab-approved'),
    };
    const all = Object.values(tabs);
    function activate(btn){ all.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }

    tabs.gen.onclick = ()=>{ activate(tabs.gen); showGen(); };
    tabs.staff.onclick = ()=>{ activate(tabs.staff); showStaff(); };
    tabs.inprog.onclick = ()=>{ activate(tabs.inprog); showList('inprog'); };
    tabs.await.onclick = ()=>{ activate(tabs.await); showList('pending'); };
    tabs.approved.onclick = ()=>{ activate(tabs.approved); showList('approved'); };

    showList('inprog');

    function node(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }

    function showGen(){
      content.innerHTML='';
      const v = node(
        '<div class="row"><div><label>Splynx Lead/Customer ID</label><input id="id" autocomplete="off" /></div>'+
        '<div style="align-self:end"><button class="btn" id="go">Generate</button></div></div>'+
        '<div id="out" class="note" style="margin-top:10px"></div>'
      );
      v.querySelector('#go').onclick = async ()=>{
        const id = v.querySelector('#id').value.trim();
        const out = v.querySelector('#out');
        if(!id){ out.textContent = 'Please enter an ID.'; return;}
        out.textContent='Working...';
        try{
          const r = await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
          const d = await r.json().catch(()=>({}));
          out.innerHTML = d.url ? ('Onboarding link: <a href="'+d.url+'" target="_blank">'+d.url+'</a>') : 'Failed.';
        }catch{ out.textContent='Network error.'; }
      };
      content.appendChild(v);
    }

    function showStaff(){
      content.innerHTML='';
      const v = node(
        '<div class="row"><div><label>Onboarding Link ID</label><input id="linkid" placeholder="e.g. 319_ab12cd34"></div>'+
        '<div style="align-self:end"><button class="btn" id="go">Generate staff code</button></div></div>'+
        '<div id="out" class="note" style="margin-top:10px"></div>'
      );
      v.querySelector('#go').onclick = async ()=>{
        const linkid = v.querySelector('#linkid').value.trim();
        const out = v.querySelector('#out');
        if(!linkid){ out.textContent='Enter linkid'; return;}
        out.textContent='Working...';
        try{
          const r = await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
          const d = await r.json().catch(()=>({}));
          out.innerHTML = d.ok ? ('Staff code: <b>'+d.code+'</b> (valid 15min)') : (d.error||'Failed');
        }catch{ out.textContent='Network error.'; }
      };
      content.appendChild(v);
    }

    async function showList(mode){
      content.innerHTML='Loading...';
      try{
        const r = await fetch('/api/admin/list?mode='+encodeURIComponent(mode));
        const d = await r.json();
        const rows = (d.items||[]).map(it => 
          '<tr>'+
            '<td>'+it.id+'</td>'+
            '<td>'+it.linkid+'</td>'+
            '<td>'+new Date(it.updated).toLocaleString()+'</td>'+
            '<td>'+
              (mode==='pending' ? '<a class="btn" href="/admin/review?linkid='+it.linkid+'">Review</a> ' : '<a class="btn-secondary" target="_blank" href="/onboard/'+it.linkid+'">Open</a> ') +
              ' <button class="btn-outline" data-del="'+it.linkid+'">Delete</button>'+
            '</td>'+
          '</tr>'
        ).join('') || '<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML = '<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        content.querySelectorAll('[data-del]').forEach(b=>{
          b.onclick = async ()=>{
            if(!confirm('Delete '+b.dataset.del+' ?')) return;
            try{
              const r = await fetch('/api/admin/delete?linkid='+encodeURIComponent(b.dataset.del),{method:'POST'});
              await showList(mode);
            }catch{}
          };
        });
      }catch{
        content.innerHTML='Failed to load.';
      }
    }
  })();`;
}

// -------------------- Info pages --------------------
async function renderEFTPage(id){
  return pageShell("EFT Payment Details", `
    <h1>EFT Payment Details</h1>
    <div class="row">
      <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
      <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    </div>
    <div class="row">
      <div><label>Account Number</label><input readonly value="62757054996"></div>
      <div><label>Branch Code</label><input readonly value="250655"></div>
    </div>
    <div class="row">
      <div><label>Reference</label><input readonly value="${esc(id||"")}"></div>
    </div>
    <p class="note">Please remember that all accounts are payable on or before the 1st of every month.</p>
    <div class="row"><button class="btn" onclick="window.print()">Print</button></div>
  `);
}

async function renderDebitPage(id){
  const r = await fetch(TERMS_DEBIT_URL);
  const terms = r.ok ? await r.text() : "Terms unavailable.";
  return pageShell("Debit Order Instruction", `
    <h1>Debit Order Instruction</h1>
    <form id="f">
      <input type="hidden" name="splynx_id" value="${esc(id||"")}">
      <div class="row">
        <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
        <div><label>Bank Account Holder ID No</label><input name="id_number" required></div>
      </div>
      <div class="row">
        <div><label>Bank</label><input name="bank_name" required></div>
        <div><label>Bank Account No</label><input name="account_number" required></div>
      </div>
      <div class="row">
        <div><label>Bank Account Type</label>
          <select name="account_type">
            <option value="cheque">Cheque</option>
            <option value="savings">Savings</option>
            <option value="transmission">Transmission</option>
          </select>
        </div>
        <div><label>Debit Order Date</label>
          <select name="debit_day">
            ${[1,7,15,25,29,30].map(x=>`<option value="${x}">${x}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="termsbox"><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(terms)}</pre></div>
      <p style="margin-top:10px"><label><input type="checkbox" name="agree" required> I agree to the Debit Order terms</label></p>
      <div class="row">
        <button class="btn" type="submit">Submit</button>
        <a class="btn-outline" href="/info/eft?id=${encodeURIComponent(id||"")}">Prefer EFT?</a>
      </div>
    </form>
    <script>
      document.getElementById('f').onsubmit = async (e)=>{
        e.preventDefault();
        const fd = new FormData(e.target);
        const o={}; for(const [k,v] of fd.entries()) o[k]=v;
        try{
          const r = await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)});
          const d = await r.json().catch(()=>({}));
          alert(d.ok ? 'Saved.' : (d.error||'Failed'));
        }catch{ alert('Network error'); }
      };
    </script>
  `);
}

// -------------------- Worker --------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const R2_PUBLIC_BASE = env.R2_PUBLIC_BASE || R2_PUBLIC_BASE_FALLBACK;

    // ------- Admin ----------
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(adminHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJS(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(()=>({}));
      if(!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress:0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/" });
      const items=[];
      for(const k of list.keys||[]){
        const s = await env.ONBOARD_KV.get(k.name,"json"); if(!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode==="inprog"   && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode==="pending"  && s.status==="pending") items.push({ linkid, id:s.id, updated });
        if (mode==="approved" && s.status==="approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if(!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      await env.ONBOARD_KV.delete(`onboard/${linkid}`);
      await env.ONBOARD_KV.delete(`pending/${linkid}`);
      return json({ ok:true });
    }

    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if(!sess) return new Response("Not found", { status:404 });
      const uploads = Array.isArray(sess.uploads)?sess.uploads:[];
      const rows = uploads.map(u =>
        `<tr><td>${esc(u.label||"-")}</td><td>${esc(u.name||"-")}</td><td>${Math.round((u.size||0)/1024)} KB</td></tr>`
      ).join("") || `<tr><td colspan="3" class="note">No files</td></tr>`;
      return new Response(pageShell("Review", `
        <h1>Review & Approve</h1>
        <div class="note">Splynx ID: <b>${esc(sess.id)}</b> &middot; LinkID: <code>${esc(linkid)}</code> &middot; Status: <b>${esc(sess.status||"n/a")}</b></div>
        <h2>Uploads</h2>
        <table><thead><tr><th>Label</th><th>Name</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="approve">Approve</button>
          <button class="btn-outline" id="reject">Reject</button>
        </div>
        <div class="note" id="msg" style="margin-top:8px"></div>
        <script>
          const msg = document.getElementById('msg');
          document.getElementById('approve').onclick = async ()=>{
            msg.textContent='Saving...';
            try{
              const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
              const d=await r.json().catch(()=>({}));
              msg.textContent = d.ok ? 'Approved.' : (d.error||'Failed');
            }catch{ msg.textContent='Network error.' }
          };
          document.getElementById('reject').onclick = async ()=>{
            const reason = prompt('Reason?') || '';
            msg.textContent='Rejecting...';
            try{
              const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
              const d=await r.json().catch(()=>({}));
              msg.textContent = d.ok ? 'Rejected.' : (d.error||'Failed');
            }catch{ msg.textContent='Network error.' }
          };
        </script>
      `), { headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if(!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved" }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(()=>({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if(!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------- Terms (service / debit) ----------
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay")||"eft").toLowerCase();
      async function get(u){ try{ const r=await fetch(u,{cf:{cacheEverything:true,cacheTtl:300}}); return r.ok?await r.text():""; }catch{return ""} }
      if (pay === "debit"){
        const t = await get(TERMS_DEBIT_URL);
        return new Response(`<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(t)}</pre>`,{headers:{ "content-type":"text/html; charset=utf-8" }});
      }
      const s = await get(TERMS_SERVICE_URL);
      return new Response(`<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(s)}</pre>`,{headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    // ------- Debit save (from /info/debit and inline) ----------
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const reqd = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for(const k of reqd){ if(!b[k]) return json({ ok:false, error:`Missing ${k}` },400); }
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      await env.ONBOARD_KV.put(`debit/${id}`, JSON.stringify({ ...b, splynx_id:id, ts }), { expirationTtl: 60*60*24*90 });
      return json({ ok:true });
    }

    // ------- OTP (WA) ----------
    async function sendWhatsAppTemplate(env, toMsisdn, code, lang="en"){
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product:"whatsapp",
        to: toMsisdn,
        type:"template",
        template:{
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
          components:[
            { type:"body", parameters:[{ type:"text", text: code }] },
            { type:"button", sub_type:"url", index:"0", parameters:[{ type:"text", text: code.slice(-6) }]}
          ]
        }
      };
      const r = await fetch(endpoint,{
        method:"POST",
        headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if(!r.ok){ const t=await r.text().catch(()=>"" ); throw new Error(`WA template send failed ${r.status} ${t}`); }
    }
    async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, body){
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"text", text:{ body } };
      const r = await fetch(endpoint,{ method:"POST", headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      if(!r.ok){ const t=await r.text().catch(()=>"" ); throw new Error(`WA text send failed ${r.status} ${t}`); }
    }

    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if(!linkid) return json({ ok:false, error:"Missing linkid" },400);
      const splynxId = linkid.split("_")[0];
      let msisdn = null;
      try{ msisdn = await fetchCustomerMsisdn(env, splynxId); }catch{ return json({ ok:false, error:"Splynx lookup failed" },502); }
      if(!msisdn) return json({ ok:false, error:"No WhatsApp number on file" },404);
      const code = String(Math.floor(100000+Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try { await sendWhatsAppTemplate(env, msisdn, code, "en"); return json({ ok:true }); }
      catch { try { await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`); return json({ ok:true, note:"sent-as-text" }); } catch { return json({ ok:false, error:"WhatsApp send failed" },502); } }
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if(!linkid || !otp) return json({ ok:false, error:"Missing params" },400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if(ok){
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
        if(sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
      }
      return json({ ok });
    }

    // ------- Onboard UI ----------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2]||"";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return new Response("Link expired or invalid",{status:404});
      return new Response(pageShell("Onboarding", `
        <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
        <div id="step"></div>
        <script>
          (function(){
            const linkid = ${JSON.stringify(linkid)};
            const stepEl = document.getElementById('step');
            const progEl = document.getElementById('prog');
            let step = 0;
            let state = { progress:0, pay_method:'eft', uploads:[] };

            function pct(){ return Math.min(100, Math.round(((step+1)/(7))*100)); }
            function setProg(){ progEl.style.width = pct()+'%'; }
            function save(){ fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{}); }
            const id = (linkid||'').split('_')[0];

            async function sendOtp(){
              const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp...';
              try{ const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})}); const d=await r.json().catch(()=>({}));
                if(m) m.textContent=d.ok?'Code sent. Check WhatsApp.':(d.error||'Failed to send.');
              }catch{ if(m) m.textContent='Network error.'; }
            }
            function sigPad(canvas){
              const ctx=canvas.getContext('2d'); let draw=false,last=null;
              function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
              resize(); window.addEventListener('resize',resize);
              function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
              function start(e){ draw=true; last=pos(e); e.preventDefault(); }
              function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
              function end(){ draw=false; last=null; }
              canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
              canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
              return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
            }

            function step0(){ // Welcome
              stepEl.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
              document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
            }

            function step1(){ // Verify
              stepEl.innerHTML = '<h2>Verify your identity</h2>'+
                '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>'+
                '<div id="waBox" class="field" style="margin-top:10px"></div>'+
                '<div id="staffBox" class="field" style="margin-top:10px;display:none"></div>';
              const wa=document.getElementById('waBox');
              wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div>'+
                '<form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required />'+
                '<button class="btn" type="submit">Verify</button></div></form>'+
                '<a class="btn-outline" id="resend">Resend code</a>';
              sendOtp();
              document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
              document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code.'; } };

              const staff=document.getElementById('staffBox');
              staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div>'+
                '<form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required />'+
                '<button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
              document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid/expired.'; } };
              const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
              pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
              pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
            }

            function drawEFT(box){
              box.innerHTML = 
                '<div class="row">'+
                  '<div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>'+
                  '<div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>'+
                '</div>'+
                '<div class="row">'+
                  '<div><label>Account Number</label><input readonly value="62757054996"></div>'+
                  '<div><label>Branch Code</label><input readonly value="250655"></div>'+
                '</div>'+
                '<div class="row"><div><label>Reference</label><input readonly value="'+id+'"></div></div>'+
                '<div class="row" style="margin-top:8px"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank">Print banking details</a></div>';
            }

            function drawDebit(box){
              const d = state.debit || {};
              box.innerHTML =
                '<div class="row">'+
                  '<div><label>Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required></div>'+
                  '<div><label>Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required></div>'+
                '</div>'+
                '<div class="row">'+
                  '<div><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required></div>'+
                  '<div><label>Account Number</label><input id="d_acc" value="'+(d.account_number||'')+'" required></div>'+
                '</div>'+
                '<div class="row">'+
                  '<div><label>Account Type</label><select id="d_type">'+
                    '<option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque</option>'+
                    '<option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option>'+
                    '<option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option>'+
                  '</select></div>'+
                  '<div><label>Debit Order Date</label><select id="d_day">'+[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join('')+'</select></div>'+
                '</div>'+
                '<div class="termsbox" id="debitTerms">Loading terms...</div>'+
                '<p style="margin-top:10px"><label><input type="checkbox" id="doAgree"> I agree to the Debit Order terms</label></p>'+
                '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="doSig" class="signature"></canvas><div class="row"><a class="btn-outline" id="doClear">Clear</a><span class="note" id="doMsg"></span></div></div>';
              (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; }})();
              const pad = sigPad(document.getElementById('doSig'));
              document.getElementById('doClear').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
              // stash accessor for continue validation
              box._collect = ()=>({
                agree: document.getElementById('doAgree').checked,
                signature: pad.dataURL(),
                form: {
                  account_holder: document.getElementById('d_holder').value.trim(),
                  id_number:      document.getElementById('d_id').value.trim(),
                  bank_name:      document.getElementById('d_bank').value.trim(),
                  account_number: document.getElementById('d_acc').value.trim(),
                  account_type:   document.getElementById('d_type').value,
                  debit_day:      document.getElementById('d_day').value
                }
              });
            }

            function step2(){ // Payment
              const pay = state.pay_method || 'eft';
              stepEl.innerHTML =
                '<h2>Payment Method</h2>'+
                '<div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div>'+
                '<div id="payBox" class="field" style="margin-top:10px"></div>'+
                '<div class="row"><a class="btn-outline" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>';
              const box=document.getElementById('payBox');
              if(pay==='eft') drawEFT(box); else drawDebit(box);

              document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; drawEFT(box); };
              document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; drawDebit(box); };

              document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; setProg(); render(); };
              document.getElementById('cont').onclick= async (e)=>{
                e.preventDefault();
                if(state.pay_method==='debit'){
                  const info = box._collect ? box._collect() : null;
                  if(!info || !info.agree){ document.getElementById('doMsg').textContent='Please agree to the terms.'; return;}
                  // save debit + signature
                  state.debit = info.form;
                  try{
                    await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ ...state.debit, splynx_id:id })});
                    await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, kind:'do', dataUrl: info.signature })});
                  }catch{}
                }
                step=3; state.progress=step; setProg(); save(); render();
              };
            }

            function step3(){ // Details
              stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
              (async()=>{
                try{
                  const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id)); const p=await r.json();
                  const cur={ full_name: state.edits?.full_name ?? p.full_name ?? '', email: state.edits?.email ?? p.email ?? '', phone: state.edits?.phone ?? p.phone ?? '', street: state.edits?.street ?? p.street ?? '', city: state.edits?.city ?? p.city ?? '', zip: state.edits?.zip ?? p.zip ?? '' };
                  document.getElementById('box').innerHTML =
                    '<div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"></div>'+
                    '<div class="row"><div><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"></div><div><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"></div></div>'+
                    '<div class="row"><div><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"></div><div><label>City</label><input id="f_city" value="'+(cur.city||'')+'"></div></div>'+
                    '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"></div>'+
                    '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>';
                  document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; setProg(); render(); };
                  document.getElementById('cont').onclick=(e)=>{ e.preventDefault();
                    state.edits={ full_name:val('f_full'), email:val('f_email'), phone:val('f_phone'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') };
                    step=4; setProg(); save(); render();
                    function val(id){ return document.getElementById(id).value.trim(); }
                  };
                }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
              })();
            }

            function step4(){ // Uploads
              stepEl.innerHTML = '<h2>Please upload your supporting documents</h2>'+
                '<p class="note">ID or Passport and proof of address (as per RICA regulations). (Max 2 files, up to 5MB each.)</p>'+
                '<div class="field"><input type="file" id="u1"></div>'+
                '<div class="field"><input type="file" id="u2"></div>'+
                '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="cont">Continue</button></div>';
              document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; setProg(); save(); render(); };
              document.getElementById('cont').onclick=async(e)=>{
                e.preventDefault();
                async function up(file){
                  if(!file) return null;
                  if(file.size > 5*1024*1024){ alert(file.name+': File too large (5MB max)'); return null; }
                  const qs='?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name);
                  const r=await fetch('/api/onboard/upload'+qs,{method:'POST',body:await file.arrayBuffer()});
                  const d=await r.json().catch(()=>({}));
                  if(d.ok) state.uploads.push({ key:d.key, name:file.name, size:file.size, label:(/id|passport/i.test(file.name)?'ID/Passport':'Proof of Address') });
                }
                await up(document.getElementById('u1').files[0]);
                await up(document.getElementById('u2').files[0]);
                step=5; setProg(); save(); render();
              };
            }

            function step5(){ // MSA sign
              stepEl.innerHTML =
                '<h2>Master Service Agreement</h2>'+
                '<div id="terms" class="termsbox">Loading terms…</div>'+
                '<p style="margin-top:10px"><label><input type="checkbox" id="msaAgree"> I have read and accept the terms</label></p>'+
                '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>'+
                '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'+
                '<div id="dl" class="note" style="margin-top:10px"></div>';
              (async()=>{ try{ const r=await fetch('/api/terms?pay=eft'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
              const pad = sigPad(document.getElementById('sig'));
              document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
              document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; setProg(); save(); render(); };
              document.getElementById('signBtn').onclick=async(e)=>{
                e.preventDefault();
                const msg=document.getElementById('sigMsg');
                if(!document.getElementById('msaAgree').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; }
                msg.textContent='Uploading signature and generating agreements…';
                try{
                  await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,kind:'msa',dataUrl:pad.dataURL()})});
                  const r = await fetch('/api/agreements/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
                  const d = await r.json().catch(()=>({}));
                  if(d.ok){
                    const dl=document.getElementById('dl');
                    let html='Download: ';
                    if(d.msa_url) html += '<a target="_blank" href="'+d.msa_url+'">MSA PDF</a> ';
                    if(d.do_url)  html += '· <a target="_blank" href="'+d.do_url+'">Debit Order PDF</a>';
                    dl.innerHTML=html;
                    step=6; setProg(); save(); render();
                  }else{
                    msg.textContent=d.error||'Failed to generate PDFs.';
                  }
                }catch{ msg.textContent='Network error.'; }
              };
            }

            function step6(){ // Done
              stepEl.innerHTML = '<h2>All set!</h2>'+
                '<p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>';
            }

            function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
            render();
          })();
        </script>
      `), { headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    // ------- progress save ----------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=>({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`,"json")) || {};
      const next = { ...existing, ...body, last_ip:getIP(request), last_ua:getUA(request), last_time:Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------- uploads ----------
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid") || "";
      const filename = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return json({ ok:false, error:"Invalid link" },404);
      const bytes = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, bytes);
      // track in session list
      const s2 = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      const uploads = Array.isArray(s2.uploads)?s2.uploads:[];
      uploads.push({ key, name: filename, size: bytes.byteLength, label: "" });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...s2, uploads }), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // ------- signature store (msa or do) ----------
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl, kind } = await request.json().catch(()=>({}));
      if(!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" },400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const key = `agreements/${linkid}/${kind==='do'?'do':'msa'}-signature.png`;
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata:{ contentType:"image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return json({ ok:false, error:"Unknown session" },404);
      const patch = kind==='do' ? { do_signature:key } : { msa_signature:key, agreement_signed:true, status:"pending" };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, ...patch }), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // ------- generate PDFs now (after MSA sign) ----------
    if (path === "/api/agreements/generate" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return json({ ok:false, error:"Invalid link" },404);

      // Load templates
      const msaT = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf");
      if(!msaT.ok) return json({ ok:false, error:"MSA template not found" },500);
      const doT  = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf");

      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

      async function loadPNG(key){
        if(!key) return null;
        const file = await env.R2_UPLOADS.get(key);
        if(!file) return null;
        return new Uint8Array(await file.arrayBuffer());
      }

      async function makeMSA(){
        const bytes = new Uint8Array(await msaT.arrayBuffer());
        const pdfDoc = await PDFDocument.load(bytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        // try to fill forms if present
        try{
          const form = pdfDoc.getForm();
          try{ form.getTextField("full_name").setText(String(sess.edits?.full_name || "")); }catch{}
          try{ form.getTextField("customer_id").setText(String(sess.id||"")); }catch{}
          try{ form.getTextField("date").setText(new Date().toLocaleDateString()); }catch{}
          try{ form.getTextField("email").setText(String(sess.edits?.email || "")); }catch{}
          form.flatten();
        }catch{}

        // place signature (page 4-ish, or last page near bottom)
        const pngBytes = await loadPNG(sess.msa_signature);
        if(pngBytes){
          const png = await pdfDoc.embedPng(pngBytes);
          const pages = pdfDoc.getPages();
          const p = pages[Math.min(pages.length-1, pages.length-1)];
          const { width } = p.getSize();
          const sigW = 180, sigH = 70;
          p.drawImage(png,{ x:70, y:120, width:sigW, height:sigH });
          p.drawText(`${sess.edits?.full_name || ""}`, { x:70, y:105, size:10, font, color:rgb(0,0,0) });
          p.drawText(new Date().toLocaleDateString(), { x:260, y:105, size:10, font });
        }

        // Audit page
        const ap = pdfDoc.addPage();
        ap.drawText("Electronic acceptance – audit record", { x:50, y:760, size:14, font, color:rgb(0.88,0,0.1) });
        const lines = [
          `Splynx ID: ${sess.id}`,
          `Link ID: ${linkid}`,
          `Date/time: ${new Date().toString()}`,
          `IP: ${sess.last_ip || ""}`,
          `User-Agent: ${sess.last_ua || ""}`
        ];
        let y=730; for(const ln of lines){ ap.drawText(ln,{ x:50, y, size:11, font }); y-=18; }

        return await pdfDoc.save();
      }

      async function makeDO(){
        if(!doT.ok) return null; // optional
        const bytes = new Uint8Array(await doT.arrayBuffer());
        const pdfDoc = await PDFDocument.load(bytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        try{
          const form = pdfDoc.getForm();
          const d = (await env.ONBOARD_KV.get(`debit/${sess.id}`,"json")) || {};
          for(const [k,v] of Object.entries({
            account_holder: d.account_holder || "",
            id_number: d.id_number || "",
            bank_name: d.bank_name || "",
            account_number: d.account_number || "",
            account_type: d.account_type || "",
            debit_day: String(d.debit_day||""),
            customer_id: String(sess.id||""),
            date: new Date().toLocaleDateString()
          })){
            try{ form.getTextField(k).setText(String(v)); }catch{}
          }
          form.flatten();
        }catch{}

        // place signature
        const pngBytes = await loadPNG(sess.do_signature);
        if(pngBytes){
          const png = await pdfDoc.embedPng(pngBytes);
          const pages = pdfDoc.getPages();
          const p = pages[Math.min(pages.length-1, 0)]; // first page likely
          const sigW=180, sigH=70;
          p.drawImage(png,{ x:70, y:120, width:sigW, height:sigH }); // ~1 inch from bottom-left
        }

        // Audit page
        const ap = pdfDoc.addPage();
        ap.drawText("Electronic acceptance – audit record", { x:50, y:760, size:14, font, color:rgb(0.88,0,0.1) });
        const lines = [
          `Splynx ID: ${sess.id}`,
          `Link ID: ${linkid}`,
          `Date/time: ${new Date().toString()}`,
          `IP: ${sess.last_ip || ""}`,
          `User-Agent: ${sess.last_ua || ""}`
        ];
        let y=730; for(const ln of lines){ ap.drawText(ln,{ x:50, y, size:11, font }); y-=18; }

        return await pdfDoc.save();
      }

      const msaBytes = await makeMSA();
      const msaKey = `agreements/${linkid}/msa.pdf`;
      await env.R2_UPLOADS.put(msaKey, msaBytes, { httpMetadata:{ contentType:"application/pdf" } });

      let doUrl=null;
      if (sess.do_signature) {
        const doBytes = await makeDO();
        if (doBytes) {
          const doKey = `agreements/${linkid}/do.pdf`;
          await env.R2_UPLOADS.put(doKey, doBytes, { httpMetadata:{ contentType:"application/pdf" } });
          doUrl = `${R2_PUBLIC_BASE}/${doKey}`;
        }
      }

      // return public URLs
      return json({ ok:true, msa_url: `${R2_PUBLIC_BASE}/${msaKey}`, do_url: doUrl });
    }

    // ------- Info pages ----------
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id")||"";
      return new Response(await renderEFTPage(id), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id")||"";
      return new Response(await renderDebitPage(id), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // ------- Splynx profile ----------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if(!id) return json({ error:"Missing id" },400);
      try{ const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch{ return json({ error:"Lookup failed" },502); }
    }

    return new Response("Not found",{status:404});
  }
};
