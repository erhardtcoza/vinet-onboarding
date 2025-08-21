// src/ui/admin.js

export function renderAdminDashboardHTML() {
  return /*html*/`
    <html>
      <head>
        <title>Vinet Onboarding Admin</title>
        <link rel="icon" href="https://static.vinet.co.za/logo.jpeg" />
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #fafafa;
            margin: 0; padding: 0;
          }
          header {
            display: flex;
            align-items: center;
            padding: 12px 20px;
            background: #d50000;
            color: #fff;
          }
          header img {
            height: 40px;
            margin-right: 12px;
          }
          h1 { font-size: 20px; margin: 0; }
          nav {
            display: flex;
            justify-content: center;
            background: #333;
          }
          nav button {
            flex: 1;
            padding: 14px;
            border: none;
            background: #333;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
          }
          nav button.active {
            background: #d50000;
          }
          section {
            padding: 20px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            background: #fff;
          }
          th, td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
          }
          th {
            background: #f5f5f5;
          }
          .actions button {
            margin-right: 6px;
            padding: 6px 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          .edit-btn { background: #1976d2; color: #fff; }
          .review-btn { background: #f9a825; color: #fff; }
          .approve-btn { background: #2e7d32; color: #fff; }
          .delete-btn { background: #c62828; color: #fff; }
        </style>
      </head>
      <body>
        <header>
          <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
          <h1>Onboarding Admin</h1>
        </header>

        <nav>
          <button class="tab-btn active" data-tab="inprogress">In Progress</button>
          <button class="tab-btn" data-tab="pending">Pending Review</button>
          <button class="tab-btn" data-tab="approved">Approved</button>
        </nav>

        <section>
          <div id="inprogress" class="tab active">
            <h2>In Progress Sessions</h2>
            <table id="inprogress-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          <div id="pending" class="tab hidden">
            <h2>Pending Review</h2>
            <table id="pending-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          <div id="approved" class="tab hidden">
            <h2>Approved</h2>
            <table id="approved-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </section>

        <script>
          // --- Tab switching ---
          const tabButtons = document.querySelectorAll(".tab-btn");
          const tabs = document.querySelectorAll(".tab");

          tabButtons.forEach(btn => {
            btn.addEventListener("click", () => {
              tabButtons.forEach(b => b.classList.remove("active"));
              tabs.forEach(t => t.classList.add("hidden"));
              btn.classList.add("active");
              document.getElementById(btn.dataset.tab).classList.remove("hidden");
            });
          });

          // --- Load data into each table ---
          async function loadSessions() {
            const res = await fetch("/api/admin/sessions");
            const data = await res.json();

            fillTable("inprogress-table", data.inprogress, ["review","delete"]);
            fillTable("pending-table", data.pending, ["edit","approve","delete"]);
            fillTable("approved-table", data.approved, []);
          }

          function fillTable(id, rows, actions) {
            const tbody = document.querySelector("#" + id + " tbody");
            tbody.innerHTML = "";
            rows.forEach(row => {
              const tr = document.createElement("tr");
              tr.innerHTML = \`
                <td>\${row.id}</td>
                <td>\${row.name || ""}</td>
                <td>\${row.email || ""}</td>
                <td>\${row.phone || ""}</td>
                <td>\${row.date || ""}</td>
                <td class="actions"></td>
              \`;
              const actionsTd = tr.querySelector(".actions");
              actions.forEach(a => {
                const btn = document.createElement("button");
                if (a === "edit") {
                  btn.textContent = "Edit";
                  btn.className = "edit-btn";
                  btn.onclick = () => window.location = "/admin/edit?id=" + row.id;
                }
                if (a === "review") {
                  btn.textContent = "Review";
                  btn.className = "review-btn";
                  btn.onclick = () => window.location = "/admin/review?id=" + row.id;
                }
                if (a === "approve") {
                  btn.textContent = "Approve";
                  btn.className = "approve-btn";
                  btn.onclick = () => approveSession(row.id);
                }
                if (a === "delete") {
                  btn.textContent = "Delete";
                  btn.className = "delete-btn";
                  btn.onclick = () => deleteSession(row.id);
                }
                actionsTd.appendChild(btn);
              });
              tbody.appendChild(tr);
            });
          }

          async function approveSession(id) {
            if (!confirm("Approve this session?")) return;
            await fetch("/api/admin/approve?id=" + id, { method: "POST" });
            loadSessions();
          }

          async function deleteSession(id) {
            if (!confirm("Delete this session?")) return;
            await fetch("/api/admin/delete?id=" + id, { method: "POST" });
            loadSessions();
          }

          loadSessions();
        </script>
      </body>
    </html>
  `;
}
