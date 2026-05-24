export const GD_STUDIO_API_BASE = "https://music-api.gdstudio.xyz/api.php";

export const FORBIDDEN_HEADERS = [
  "user-agent",
  "referer",
  "host",
  "origin",
  "cookie",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "connection",
  "content-length",
];

export const IS_LOCAL_DEV =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

export const API_PREFIX = "";
export const SELF_HOSTED_PROXY = `${API_PREFIX}/api/cors-proxy?url=`;

export const DEFAULT_PROXIES: string[] = [SELF_HOSTED_PROXY, "https://corsproxy.io/?"];
