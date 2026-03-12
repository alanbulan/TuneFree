import { onRequestPost as __api_upstream_ts_onRequestPost } from "F:\\Code\\Personal\\TuneFree_Mobile\\functions\\api\\upstream.ts"
import { onRequest as __api___path___ts_onRequest } from "F:\\Code\\Personal\\TuneFree_Mobile\\functions\\api\\[[path]].ts"

export const routes = [
    {
      routePath: "/api/upstream",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_upstream_ts_onRequestPost],
    },
  {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___path___ts_onRequest],
    },
  ]