// src/ui/admin.js
import { renderAdminReviewHTML } from "./admin-review.js";

/**
 * Renders the full Admin Dashboard page
 */
export function renderAdminPage(sessions = { inprogress: [], pending: [], approved: [] }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Admin Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #fafafa; }
      h1 { color: #b30000; }
      .tabs { display: flex; gap: 1rem; margin-bottom: 1rem; }
      .tab { padding: 0.5rem 1rem; background: #eee; border-radius: 5px; cursor: pointer; }
      .tab.active { background: #b30000; color: white; }
      .session-list { margin-top: 1rem; }
      .session-card { background: white; padding: 1rem; margin-bottom: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      button { margin-left: 0.5rem; padding: 0.3rem 0.6rem; border: none; border-radius: 4px; cursor: pointer; }
      button.approve { background: green; color: white; }
      button.reject { background: red; color: white; }
    </style>
  </head>
  <body>
    <h1>Onboarding Admin Dashboard</h1>
    <div class="tabs">
      <div class="tab active" data-tab="inprogress">In Progress</div>
      <div class="tab" data-tab="pending">Pending Review</div>
      <div class="tab" data-tab="approved">Approved</div>
    </div>

    <div id="tab-content">
      ${renderAdminReviewHTML(sessions)}
    </div>

    <script>
      document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          const section = tab.dataset.tab;
          fetch("/api/admin/list?section=" + section)
            .then(r => r.text())
            .then(html => { document.getElementById("tab-content").innerHTML = html; });
        });
      });

      document.addEventListener("click", e => {
        if (e.target.classList.contains("approve") || e.target.classList.contains("reject")) {
          const id = e.target.dataset.id;
          const action = e.target.classList.contains("approve") ? "approve" : "reject";
          fetch("/api/admin/" + action + "/" + id, { method: "POST" })
            .then(() => location.reload());
        }
      });
    </script>
  </body>
  </html>
  `;
}
