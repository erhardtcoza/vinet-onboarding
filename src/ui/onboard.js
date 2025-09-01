// /src/ui/onboard.js
import { LOGO_URL } from "../constants.js";

// ---------- Onboarding HTML renderer ----------
export function renderOnboardUI(linkid, turnstileSiteKey = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:680px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.2em 0 1.8em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em;flex-wrap:wrap}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid #e2001a;color:#e2001a;padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:#e2001a;color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
  .accent { height:8px; background:#e2001a; border-radius:4px; width:60%; max-width:540px; margin:10px auto 18px; }
  .final p { margin:.35em 0 .65em; }
  .final ul { margin:.25em 0 0 1em; }
  .doclist { list-style:none; margin:.4em 0 0 0; padding:0; }
  .doclist .doc-item { display:flex; align-items:center; gap:.5em; margin:.45em 0; }
  .doclist .doc-ico { display:inline-flex; width:18px; height:18px; opacity:.9; }
  .doclist .doc-ico svg { width:18px; height:18px; }
  .doclist a { text-decoration:none; }
  .doclist a:hover { text-decoration:underline; }
  .error{color:#b00020;font-size:.95em;margin-top:.25em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  // Step order: 0 Begin, 1 Verify, 2 Personal, 3 Uploads, 4 Payment, 5 MSA, 6 Final
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  // Step 0: Begin
  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We’ll quickly verify you and capture the information required by RICA to activate your service.</p><button class="btn" id="start">Let’s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

// Step 1: Verify (WhatsApp OTP or Staff code)
function step1(){
  stepEl.innerHTML = [
    '<h2>Verify your identity</h2>',
    '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
    '<div id="waBox" class="field" style="margin-top:10px;"></div>',
    '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
  ].join('');

  const wa = document.getElementById('waBox');
  wa.innerHTML = ''
    + '<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div>'
    + '<form id="otpForm" autocomplete="off" class="field">'
    + '  <div class="row">'
    + '    <input id="otp" name="otp" type="text" inputmode="numeric" '
    + '           pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required />'
    + '    <button class="btn" type="submit">Verify</button>'
    + '  </div>'
    + '</form>'
    + '<a class="btn-outline" id="resend">Resend code</a>';

  // Send initial WhatsApp OTP
  sendOtp();
  document.getElementById('resend').onclick = (e)=>{ e.preventDefault(); sendOtp(); };

  // Robust client-side validation (works even if browser pattern is picky)
  const otpInput = document.getElementById('otp');
  otpInput.addEventListener('input', () => {
    // keep only digits and trim to 6
    otpInput.value = otpInput.value.replace(/\D+/g, '').slice(0, 6);
  });

  document.getElementById('otpForm').onsubmit = async (e) => {
    e.preventDefault();
    const otp = otpInput.value.trim();
    if (otp.length !== 6) {
      document.getElementById('otpmsg').textContent = 'Please enter the 6‑digit code.';
      return;
    }
    const r = await fetch('/api/otp/verify', {
      method:'POST',
      body: JSON.stringify({ linkid, otp, kind: "wa" })
    });
    const d = await r.json().catch(()=>({ ok:false }));
    if (d.ok) { step=2; state.progress=step; setProg(); save(); render(); }
    else { document.getElementById('otpmsg').textContent = 'Invalid code. Try again.'; }
  };

  // Staff code UI
  const staff = document.getElementById('staffBox');
  staff.innerHTML = ''
    + '<div class="note">Ask Vinet for a one-time staff code.</div>'
    + '<form id="staffForm" autocomplete="off" class="field">'
    + '  <div class="row">'
    + '    <input id="staffOtp" name="otp" type="text" inputmode="numeric" '
    + '           pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code from Vinet" required />'
    + '    <button class="btn" type="submit">Verify</button>'
    + '  </div>'
    + '</form>'
    + '<div id="staffMsg" class="note"></div>';

  const staffInput = document.getElementById('staffOtp');
  staffInput.addEventListener('input', () => {
    staffInput.value = staffInput.value.replace(/\D+/g, '').slice(0, 6);
  });

  document.getElementById('staffForm').onsubmit = async (e) => {
    e.preventDefault();
    const otp = staffInput.value.trim();
    if (otp.length !== 6) {
      document.getElementById('staffMsg').textContent = 'Please enter the 6‑digit code.';
      return;
    }
    const r = await fetch('/api/otp/verify', {
      method:'POST',
      body: JSON.stringify({ linkid, otp, kind: "staff" })
    });
    const d = await r.json().catch(()=>({ ok:false }));
    if (d.ok) { step=2; state.progress=step; setProg(); save(); render(); }
    else { document.getElementById('staffMsg').textContent = 'Invalid or expired staff code.'; }
  };

  // Toggle tabs
  const pwa = document.getElementById('p-wa'), pst = document.getElementById('p-staff');
  pwa.onclick = () => { pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
  pst.onclick = () => { pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
}
  // Step 2: Personal info (pulled from Splynx, editable)
  function step2(){
    stepEl.innerHTML='<h2>Confirm your details</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', passport: state.edits.passport ?? p.passport ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=3; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // Step 3: Uploads (RICA: ID + Proof of Address <= 3 months)
  function step3(){
    stepEl.innerHTML=[
      '<h2>Upload documents</h2>',
      '<div class="note">Per the South African RICA Act, please upload the following (clear photo or PDF):</div>',
      '<ul class="note" style="margin:.4em 0 0 1em">',
        '<li><b>ID Document</b> (required)</li>',
        '<li><b>Proof of Address</b> (required; not older than 3 months)</li>',
      '</ul>',
      '<div class="field"><label>ID Document</label><input type="file" id="file_id" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><label>Proof of Address (≤ 3 months)</label><input type="file" id="file_poa" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uErr" class="error"></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };

    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');
      const err = document.getElementById('uErr');
      err.textContent = '';
      const fId = document.getElementById('file_id').files[0];
      const fPoa = document.getElementById('file_poa').files[0];
      if (!fId || !fPoa) { err.textContent = 'Both documents are required.'; return; }
      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { err.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||label).replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }
      try {
        msg.textContent = 'Uploading...';
        const u1 = await up(fId, 'ID Document');
        const u2 = await up(fPoa, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        msg.textContent = 'Uploaded.';
        step=4; state.progress=step; setProg(); save(); render();
      } catch (e) {
        if (!err.textContent) err.textContent='Upload failed.';
      }
    };
  }

  // Step 4: Payment (EFT or Debit Order)
  function step4(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back4" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');

    function renderEft(){
      const id = (linkid||'').split('_')[0];
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML = [
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a></div>'
      ].join('');
    }

    let dPad = null;
    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('debitBox');
      box.style.display = 'block';
      box.innerHTML = [
        '<div class="row">',
          '<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required /></div>',
          '<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required /></div>',
          '<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick = (e)=>{ e.preventDefault(); dPad.clear(); };
    }

    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; dPad=null; }
    function hideEft(){ const box=document.getElementById('eftBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); renderEft(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; hideEft(); renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm(); else renderEft();

    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        const msg = document.getElementById('d_msg');
        if (!document.getElementById('d_agree').checked) { msg.textContent='Please confirm you agree to the Debit Order terms.'; return; }
        if (!dPad || dPad.isEmpty()) { msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed:         true
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id, linkid }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
      }
      step=5; state.progress=step; setProg(); save(); render();
    };
  }

  // Step 5: MSA
  function step5(){
    stepEl.innerHTML = [
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back5">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back5').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  // Step 6: Final
  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    const docIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5L18.5 8H14V3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zM8 9h4v1.5H8V9z"/></svg>';
    stepEl.innerHTML = [
      '<div class="final">',
        '<h2 style="color:#e2001a;margin:0 0 .2em">All set!</h2>',
        '<div class="accent"></div>',
        '<p>Thanks – we’ve recorded your information. Our team will be in contact shortly.</p>',
        '<p>If you have any questions, please contact our sales team:</p>',
        '<ul>',
          '<li><b>Phone:</b> <a href="tel:+27210070200">021 007 0200</a></li>',
          '<li><b>Email:</b> <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></li>',
        '</ul>',
        '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
        '<div class="field"><b>Your agreements</b> <span class="note">(links work after signing; PDFs generate instantly)</span></div>',
        '<ul class="doclist">',
          '<li class="doc-item"><span class="doc-ico">', docIcon, '</span>',
            '<a href="/pdf/msa/', linkid, '" target="_blank">Master Service Agreement (PDF)</a>',
            ' &nbsp;•&nbsp; <a href="/agreements/msa/', linkid, '" target="_blank">View in browser</a>',
          '</li>',
          (showDebit
            ? '<li class="doc-item"><span class="doc-ico">' + docIcon + '</span>' +
              '<a href="/pdf/debit/' + linkid + '" target="_blank">Debit Order Agreement (PDF)</a>' +
              ' &nbsp;•&nbsp; <a href="/agreements/debit/' + linkid + '" target="_blank">View in browser</a>' +
              '</li>'
            : ''),
        '</ul>',
      '</div>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}
