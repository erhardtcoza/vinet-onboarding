// src/routes/admin.js
import { html } from '../lib/utils';

export function renderAdminHome() {
  return html`
    <div class="text-center">
      <h1 class="text-2xl font-bold mb-6">Vinet Onboarding Admin</h1>
      <div class="grid grid-cols-1 gap-4">
        <a href="/generate" class="btn">1. Generate Onboarding Link</a>
        <a href="/verify" class="btn">2. Generate WhatsApp OTP</a>
        <a href="/pending" class="btn">3. Pending Onboard Clients</a>
        <a href="/awaiting-approval" class="btn">4. Awaiting Admin Approval</a>
        <a href="/approved" class="btn">5. Approved Clients</a>
      </div>
    </div>
  `;
}

export async function handleAdminRequest(path) {
  switch (path) {
    case '/':
    case '/admin':
      return new Response(renderAdminHome(), { headers: { 'Content-Type': 'text/html' } });

    // Add handlers for other routes like /generate, /verify, etc.

    default:
      return new Response('Not Found', { status: 404 });
  }
}
