// src/ui/admin.js

export function renderAdminReviewHTML(sessions) {
  return /*html*/ `
    <div class="admin-list">
      ${sessions
        .map(
          (s) => `
        <div class="session-card" data-id="${s.id}">
          <h3>${s.full_name || "Unnamed"} (${s.status})</h3>
          <p><strong>Email:</strong> ${s.email || "-"}<br/>
             <strong>Phone:</strong> ${s.phone || "-"}<br/>
             <strong>Passport:</strong> ${s.passport || "-"}<br/>
             <strong>Address:</strong> ${s.address || "-"}, ${s.city || ""} ${s.zip || ""}</p>
          <p><strong>Created:</strong> ${new Date(s.created_at).toLocaleString()}</p>
          
          ${
            s.splynx_id
              ? `<p class="splynx-id"><strong>Splynx ID:</strong> ${s.splynx_id}</p>`
              : ""
          }

          <div class="actions">
            ${
              s.status === "inprogress"
                ? `
                  <button class="approve-btn" data-id="${s.id}">Approve</button>
                  <button class="reject-btn" data-id="${s.id}">Reject</button>
                `
                : ""
            }
            <button class="edit-btn" data-id="${s.id}">Edit</button>
            <button class="delete-btn" data-id="${s.id}">Delete</button>
          </div>
        </div>
      `
        )
        .join("")}
    </div>

    <script>
      document.querySelectorAll(".approve-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          if (!confirm("Approve this onboarding?")) return;
          const res = await fetch("/api/admin/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, status: "approved" })
          });
          const data = await res.json();
          alert("Approved. Splynx ID: " + (data.splynx_id || "unknown"));
          location.reload();
        });
      });

      document.querySelectorAll(".reject-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          if (!confirm("Reject this onboarding?")) return;
          await fetch("/api/admin/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, status: "rejected" })
          });
          location.reload();
        });
      });

      document.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          if (!confirm("Delete this onboarding? This will remove all KV/R2 docs as well.")) return;
          await fetch("/api/admin/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
          });
          location.reload();
        });
      });

      document.querySelectorAll(".edit-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          window.location.href = "/admin/edit?id=" + id;
        });
      });
    </script>

    <style>
      .admin-list {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }
      .session-card {
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 1rem;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .session-card h3 {
        margin-top: 0;
        color: #b30000;
      }
      .session-card .splynx-id {
        color: #006600;
        font-weight: bold;
      }
      .actions {
        margin-top: 0.5rem;
      }
      .actions button {
        margin-right: 0.5rem;
        padding: 0.3rem 0.7rem;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      }
      .approve-btn { background: #28a745; color: #fff; }
      .reject-btn { background: #dc3545; color: #fff; }
      .delete-btn { background: #6c757d; color: #fff; }
      .edit-btn { background: #007bff; color: #fff; }
    </style>
  `;
}
