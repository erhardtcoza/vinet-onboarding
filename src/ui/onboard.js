// src/ui/onboard.js
import { LOGO_URL } from "../constants.js";

export function renderOnboardHTMLShell({ linkid, siteKey }) {
  // NOTE: siteKey is there if you later re-add Turnstile in step0
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Onboarding • Vinet</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#fafbfc;color:#232;margin:0;padding:0}
  .card{background:#fff;max-width:680px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px;height:auto}
  h1,h2{color:#e2001a;margin:.2em 0 .4em;font-weight:600}
  p{line-height:1.4}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0;font-weight:600}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em;font-weight:600;text-align:center}
  .field{margin:1em 0}
  input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd;font-family:inherit}
  .note{font-size:12px;color:#666}
  .error{color:#b00020;font-size:.95em;margin-top:.25em}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.2em 0 1.8em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em;flex-wrap:wrap}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid #e2001a;color:#e2001a;padding:.6em 1.2em;border-radius:999px;cursor:pointer;font-weight:600}
  .pill.active{background:#e2001a;color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa;font-size:.9em;line-height:1.4;white-space:pre-wrap}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:flex-start;gap:.6em;font-weight:700;font-size:.9em;line-height:1.35}
  .bigchk input[type=checkbox]{width:22px;height:22px;margin-top:.15em}
  .accent { height:8px; background:#e2001a; border-radius:4px; width:60%; max-width:540px; margin:10px auto 18px; }
  .final p { margin:.35em 0 .65em; }
  .final ul { margin:.25em 0 0 1em; padding-left:1em; }
  .final li { margin:.3em 0; }
  .doclist { list-style:none; margin:.4em 0 0 0; padding:0; }
  .doclist .doc-item { display:flex; align-items:flex-start; gap:.5em; margin:.45em 0; line-height:1.3; }
  .doclist .doc-ico { display:inline-flex; width:18px; height:18px; opacity:.9; flex-shrink:0; margin-top:2px; color:#444; }
  .doclist .doc-ico svg { width:18px; height:18px; }
  .doclist a { text-decoration:none; color:#0a58ca; word-break:break-word; }
  .doclist a:hover { text-decoration:underline; }
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
    <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
    <div id="root"><!-- app mounts here --></div>
  </div>

  <script>
    // minimal bootstrap data for the frontend app
    window.__ONBOARD_CTX__ = {
      linkid: ${JSON.stringify(linkid)},
      siteKey: ${JSON.stringify(siteKey || "")}
    };
  </script>
  <script src="/onboard-app.js" defer></script>
</body>
</html>`;
}
