// src/ui/admin.js
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

        <button type="submit">Save Changes</button>
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
          const updated = await res.json();
          document.getElementById("saveStatus").innerText = "✅ Saved successfully!";
          console.log("Updated profile:", updated);
        } else {
          const err = await res.text();
          document.getElementById("saveStatus").innerText = "❌ Save failed: " + err;
        }
      });
    </script>
  `;
}
