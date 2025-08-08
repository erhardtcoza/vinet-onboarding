// Let's begin modularizing your onboarding app.

// We'll start by splitting src/index.js into multiple files:
// - src/index.js (entry point, routes only)
// - src/routes/admin.js (admin panel logic)
// - src/routes/onboard.js (client onboarding logic)
// - src/lib/splynx.js (Splynx API helpers)
// - src/lib/utils.js (utility functions)
// - src/lib/pdf.js (PDF generation logic)

// Initial file: src/index.js
import { handleAdminRoutes } from './routes/admin.js';
import { handleOnboardRoutes } from './routes/onboard.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/admin')) {
      return handleAdminRoutes(request, env, ctx);
    }

    if (pathname.startsWith('/onboard') || pathname.startsWith('/info')) {
      return handleOnboardRoutes(request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  },
};
