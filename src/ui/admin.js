// src/ui/admin.js

export function renderAdminReviewHTML(profile) {
  return /*html*/ `
    <div class="admin-review">
      <h2>Review Client Information</h2>

      <form id="review-form">
        <!-- Identity -->
        <label>Full Name
          <input type="text" name="full_name" value="${profile.full_name || ""}" />
        </label>

        <label>Email
          <input type="email" name="email" value="${profile.email || ""}" />
        </label>

        <label>Billing Email
          <input type="email" name="billing_email" value="${profile.billing_email || ""}" />
        </label>

        <label>Phone
          <input type="text" name="phone" value="${profile.phone || ""}" />
        </label>

        <!-- ID / Passport -->
        <label>Passport / ID Number
          <input type="text" name="passport" value="${profile.passport || ""}" />
        </label>
        <label>National ID (additional_attributes.social_id)
          <input type="text" name="id_number" value="${profile.id_number || ""}" />
        </label>

        <!-- Address -->
        <label>Street Address
          <input type="text" name="address" value="${profile.address || ""}" />
        </label>

        <label>City
          <input type="text" name="city" value="${profile.city || ""}" />
        </label>

        <label>ZIP Code
          <input type="text" name="zip" value="${profile.zip || ""}" />
        </label>

        <!-- Banking / Payment -->
        <h3>Banking & Payment</h3>

        <label>Payment Method
          <input type="text" name="payment_method" value="${profile.payment_method || ""}" />
        </label>

        <label>Bank Name
          <input type="text" name="bank_name" value="${profile.bank_name || ""}" />
        </label>

        <label>Bank Account
          <input type="text" name="bank_account" value="${profile.bank_account || ""}" />
        </label>

        <label>Bank Branch
          <input type="text" name="bank_branch" value="${profile.bank_branch || ""}" />
        </label>

        <!-- Agreement Metadata -->
        <h3>Agreement Metadata</h3>

        <label>Signed IP
          <input type="text" name="signed_ip" value="${profile.signed_ip || ""}" />
        </label>

        <label>Signed Device
          <input type="text" name="signed_device" value="${profile.signed_device || ""}" />
        </label>

        <label>Signed Date
          <input type="text" name="signed_date" value="${profile.signed_date || ""}" />
        </label>

        <div class="actions">
          <button type="submit">Save Changes</button>
        </div>
      </form>
    </div>
  `;
}
