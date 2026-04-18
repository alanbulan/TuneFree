export const EXTENDED_AGGREGATE_SOURCES = ["joox", "bilibili"] as const;

export const GD_STUDIO_ATTRIBUTION = "GD音乐台 (music.gdstudio.xyz)";
export const GD_STUDIO_RATE_LIMIT_HINT = "5 分钟内不超过 50 次请求";

const SOURCE_LABELS: Record<string, { short: string; full: string }> = {
  netease: { short: "网易云", full: "网易云" },
  qq: { short: "QQ", full: "QQ音乐" },
  kuwo: { short: "酷我", full: "酷我音乐" },
  joox: { short: "JOOX", full: "JOOX" },
  bilibili: { short: "B站", full: "Bilibili" },
};

const SOURCE_BADGE_CLASSES: Record<string, string> = {
  netease: "bg-red-100 text-red-600",
  qq: "bg-green-100 text-green-600",
  kuwo: "bg-yellow-100 text-yellow-700",
  joox: "bg-purple-100 text-purple-700",
  bilibili: "bg-pink-100 text-pink-600",
};

export const getMusicSourceLabel = (
  source: string,
  variant: "short" | "full" = "short",
): string => SOURCE_LABELS[source]?.[variant] || source;

export const getMusicSourceBadgeClass = (source: string): string =>
  SOURCE_BADGE_CLASSES[source] || "bg-gray-200 text-gray-600";
