// src/ui/admin.js

/**
 * Render a list of sessions into Admin HTML cards
 * Each session shows info + Approve / Reject buttons
 */
export function renderAdminReviewHTML(sections) {
  const html = [];

  for (const [section, sessions] of Object.entries(sections)) {
    html.push(`<h2 class="section-title">${capitalize(section)}</h2>`);
    if (!sessions || sessions.length === 0) {
      html.push(`<p>No sessions in ${section}.</p>`);
      continue;
    }

    html.push(`<div class="session-list">`);
    for (const s of sessions) {
      html.push(`
        <div class="session-card">
          <div class="session-body">
            <strong>${s.full_name || "Unnamed"}</strong><br/>
            Email: ${s.email || "—"}<br/>
            Phone: ${s.phone || "—"}<br/>
            Passport: ${s.passport || "—"}<br/>
            Address: ${s.address || "—"}<br/>
            City: ${s.city || "—"}<br/>
            ZIP: ${s.zip || "—"}<br/>
          </div>
          <div class="session-actions">
            <button class="approve-btn" data-id="${s.id}">Approve</button>
            <button class="reject-btn" data-id="${s.id}">Reject</button>
          </div>
        </div>
      `);
    }
    html.push(`</div>`);
  }

  // Inject script to wire buttons
  html.push(`
    <script>
      document.querySelectorAll(".approve-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          if (!confirm("Approve session " + id + "?")) return;
          const res = await fetch("/api/admin/approve/" + id, { method: "POST" });
          if (res.ok) {
            alert("Session " + id + " approved!");
            location.reload();
          } else {
            alert("Failed to approve session " + id);
          }
        });
      });

      document.querySelectorAll(".reject-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          if (!confirm("Reject session " + id + "?")) return;
          const res = await fetch("/api/admin/reject/" + id, { method: "POST" });
          if (res.ok) {
            alert("Session " + id + " rejected!");
            location.reload();
          } else {
            alert("Failed to reject session " + id);
          }
        });
      });
    </script>
  `);

  return wrapAdminPage(html.join("\n"));
}

/**
 * Wrap with a minimal admin HTML shell
 */
function wrapAdminPage(content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Onboarding Admin</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 2rem; background: #fafafa; }
          h2.section-title { margin-top: 2rem; color: #333; }
          .session-list { display: flex; flex-wrap: wrap; gap: 1rem; }
          .session-card {
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 1rem;
            width: 280px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .session-body { margin-bottom: 1rem; line-height: 1.4; }
          .session-actions button {
            padding: 0.4rem 0.8rem;
            border: none;
            border-radius: 4px;
            margin-right: 0.5rem;
            cursor: pointer;
          }
          .approve-btn { background: #2e7d32; color: white; }
          .reject-btn { background: #c62828; color: white; }
        </style>
      </head>
      <body>
        <h1>Onboarding Admin Dashboard</h1>
        ${content}
      </body>
    </html>
  `;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
