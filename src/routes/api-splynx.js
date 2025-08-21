// src/routes/api-splynx.js
import { Router } from "itty-router";
import {
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  splynxGET,
  splynxPOST,
  splynxPUT,
  splynxCreateAndUpload,
} from "../splynx.js";

const router = Router({ base: "/api/splynx" });

// GET /api/splynx/profile?id=319
router.get("/profile", async (req, env) => {
  const { id } = req.query;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
  }
  try {
    const profile = await fetchProfileForDisplay(env, id);
    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// GET /api/splynx/msisdn?id=319
router.get("/msisdn", async (req, env) => {
  const { id } = req.query;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
  }
  try {
    const msisdn = await fetchCustomerMsisdn(env, id);
    return new Response(JSON.stringify(msisdn), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// Proxy GET -> Splynx
// Example: /api/splynx/get?path=/admin/customers/319
router.get("/get", async (req, env) => {
  const { path } = req.query;
  if (!path) {
    return new Response(JSON.stringify({ error: "Missing path" }), { status: 400 });
  }
  try {
    const result = await splynxGET(env, path);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// Proxy POST -> Splynx
router.post("/post", async (req, env) => {
  const { path } = req.query;
  if (!path) {
    return new Response(JSON.stringify({ error: "Missing path" }), { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await splynxPOST(env, path, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// Proxy PUT -> Splynx
router.put("/put", async (req, env) => {
  const { path } = req.query;
  if (!path) {
    return new Response(JSON.stringify({ error: "Missing path" }), { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await splynxPUT(env, path, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// File Upload -> Splynx
// Example: POST /api/splynx/upload?type=lead&id=4941
// Example: POST /api/splynx/upload?type=customer&id=319
router.post("/upload", async (req, env) => {
  const { id, type } = req.query;
  if (!id || !type) {
    return new Response(JSON.stringify({ error: "Missing id or type" }), {
      status: 400,
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) {
      return new Response(JSON.stringify({ error: "Missing file" }), {
        status: 400,
      });
    }

    // Delegate to splynx.js
    const result = await splynxCreateAndUpload(env, type, id, file);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

export default router;
