// Tiny router used by index.js
export class Router {
  constructor() { this.routes = []; }
  add(method, path, handler) {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }
  #match(method, pathname) {
    method = method.toUpperCase();
    return this.routes.find(r => {
      if (r.method !== method) return false;
      if (r.path === pathname) return true;
      // naive wildcard: "/api/*"
      if (r.path.endsWith("*")) {
        const base = r.path.slice(0, -1);
        return pathname.startsWith(base);
      }
      return false;
    });
  }
  async handle(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const hit = this.#match(request.method, pathname);
    if (hit) return hit.handler(request, env, ctx);
    return null;
  }
}
