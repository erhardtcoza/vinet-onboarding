// src/ui/admin.js

export function renderAdminDashboardHTML() {
  return /*html*/`
    <div class="admin-dashboard">
      <h1>Onboarding Admin Dashboard</h1>
      <div class="tabs">
        <button data-tab="inprogress" class="active">In Progress</button>
        <button data-tab="pending">Pending Review</button>
        <button data-tab="approved">Approved</button>
      </div>
      <div id="tabContent">Loading...</div>
    </div>

    <script>
      const tabs = document.querySelectorAll(".tabs button");
      const tabContent = document.getElementById("tabContent");

      async function loadTab(status) {
        tabContent.innerHTML = "Loading...";
        try {
          const res = await fetch("/api/admin/list?status=" + status);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          if (!data.length) {
            tabContent.innerHTML = "<p>No entries found.</p>";
            return;
          }
          tabContent.innerHTML = "<ul>" + data.map(d => 
            \`<li><a href="#" data-id="\${d.id}">\${d.full_name || d.email || d.id}</a></li>\`
          ).join("") + "</ul>";

          tabContent.querySelectorAll("a").forEach(a => {
            a.addEventListener("click", async (e) => {
              e.preventDefault();
              const id = a.dataset.id;
              const res = await fetch("/api/admin/profile?id=" + id);
              if (!res.ok) {
                tabContent.innerHTML = "Failed to load profile";
                return;
              }
              const profile = await res.json();
              tabContent.innerHTML = renderAdminReviewHTML(profile);
            });
          });
        } catch (err) {
          tabContent.innerHTML = "❌ " + err.message;
        }
      }

      tabs.forEach(btn => {
        btn.addEventListener("click", () => {
          tabs.forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          loadTab(btn.dataset.tab);
        });
      });

      loadTab("inprogress");
    </script>
  `;
}

export function renderAdminReviewHTML(profile) {
  return /*html*/`
    <div class="admin-review">
      <h2>Review Onboarding Profile</h2>
      <form id="reviewForm">
        <input type="hidden" name="id" value="${profile.id}" />

        <label>Full Name</label>
        <input name="full_name" value="${profile.full_name || ""}" />

        <label>Email</label>
        <input name="email" value="${profile.email || ""}" />

        <label>Billing Email</label>
        <input name="billing_email" value="${profile.billing_email || ""}" />

        <label>Phone</label>
        <input name="phone" value="${profile.phone || ""}" />

        <label>ID / Passport</label>
        <input name="id_number" value="${profile.id_number || profile.passport || ""}" />

        <label>Street Address</label>
        <input name="address" value="${profile.address || ""}" />

        <label>City</label>
        <input name="city" value="${profile.city || ""}" />

        <label>ZIP</label>
        <input name="zip" value="${profile.zip || ""}" />

        <h3>Banking Details</h3>
        <label>Payment Method</label>
        <input name="payment_method" value="${profile.payment_method || ""}" />

        <label>Bank Name</label>
        <input name="bank_name" value="${profile.bank_name || ""}" />

        <label>Bank Account</label>
        <input name="bank_account" value="${profile.bank_account || ""}" />

        <label>Bank Branch</label>
        <input name="bank_branch" value="${profile.bank_branch || ""}" />

        <h3>Agreement Metadata</h3>
        <label>Signed IP</label>
        <input name="signed_ip" value="${profile.signed_ip || ""}" />

        <label>Signed Device</label>
        <input name="signed_device" value="${profile.signed_device || ""}" />

        <label>Signed Date</label>
        <input name="signed_date" value="${profile.signed_date || ""}" />

        <div class="actions">
          <button type="submit">💾 Save Changes</button>
          <button type="button" id="approveBtn">✅ Approve</button>
          <button type="button" id="rejectBtn">❌ Reject</button>
        </div>
      </form>
      <div id="saveStatus"></div>
    </div>

    <script>
      const form = document.getElementById("reviewForm");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const payload = {};
        formData.forEach((v, k) => payload[k] = v);

        document.getElementById("saveStatus").innerText = "Saving...";

        const res = await fetch("/api/admin/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          document.getElementById("saveStatus").innerText = "✅ Saved successfully!";
        } else {
          const err = await res.text();
          document.getElementById("saveStatus").innerText = "❌ Save failed: " + err;
        }
      });

      async function changeStatus(status) {
        document.getElementById("saveStatus").innerText = "Updating status...";
        const res = await fetch("/api/admin/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "${profile.id}", status })
        });
        if (res.ok) {
          document.getElementById("saveStatus").innerText = "✅ Status updated to " + status;
        } else {
          const err = await res.text();
          document.getElementById("saveStatus").innerText = "❌ Failed: " + err;
        }
      }

      document.getElementById("approveBtn").addEventListener("click", () => changeStatus("approved"));
      document.getElementById("rejectBtn").addEventListener("click", () => changeStatus("rejected"));
    </script>
  `;
}
