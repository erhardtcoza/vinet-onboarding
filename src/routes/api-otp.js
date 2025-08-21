// src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

export async function handleOtpRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/otp/send" && request.method === "POST") {
    try {
      const { id } = await request.json();
      if (!id) return new Response("Missing id", { status: 400 });

      const msisdn = await fetchCustomerMsisdn(env, id);
      if (!msisdn || !msisdn.phone) {
        return new Response(
          JSON.stringify({ error: "No MSISDN found" }),
          { status: 404 }
        );
      }

      // For now just return the msisdn (SMS sending happens elsewhere)
      return new Response(JSON.stringify({ success: true, msisdn }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `OTP error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  return new Response("Not found", { status: 404 });
}
