import { onRequest as __api_cors_proxy_ts_onRequest } from "F:\\Code\\Personal\\TuneFree_Mobile\\functions\\api\\cors-proxy.ts"

export const routes = [
    {
      routePath: "/api/cors-proxy",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_cors_proxy_ts_onRequest],
    },
  ]