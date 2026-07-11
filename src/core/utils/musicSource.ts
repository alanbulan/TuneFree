export const SEARCH_SOURCE_OPTIONS = [
  "netease", "qq", "kuwo", "joox",
] as const;
export const EXTENDED_AGGREGATE_SOURCES = ["joox"] as const;
export const GD_STUDIO_ATTRIBUTION = "GD音乐台 (music.gdstudio.xyz)";
export const GD_STUDIO_RATE_LIMIT_HINT = "5 分钟内不超过 50 次请求";

const SOURCE_LABELS: Record<string, { short: string; full: string }> = {
  netease: { short: "网易云", full: "网易云" },
  qq: { short: "QQ", full: "QQ音乐" },
  kuwo: { short: "酷我", full: "酷我音乐" },
  joox: { short: "JOOX", full: "JOOX" },
};

export const getMusicSourceLabel = (
  source: string,
  variant: "short" | "full" = "short",
): string => SOURCE_LABELS[source]?.[variant] || source;
