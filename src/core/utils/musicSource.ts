export const GD_STUDIO_ATTRIBUTION = "GD音乐台 (music.gdstudio.xyz)";
export const GD_STUDIO_RATE_LIMIT_HINT = "5 分钟内不超过 50 次请求";

const SOURCE_LABELS: Record<string, { short: string; full: string }> = {
  netease: { short: "网易云", full: "网易云" },
  qq: { short: "QQ", full: "QQ音乐" },
  kuwo: { short: "酷我", full: "酷我音乐" },
  joox: { short: "JOOX", full: "JOOX" },
  // 自定义音源可以声明下面这些平台（kg / mg 本应用只用于兜底解析）。
  kugou: { short: "酷狗", full: "酷狗音乐" },
  migu: { short: "咪咕", full: "咪咕音乐" },
  bilibili: { short: "B站", full: "哔哩哔哩" },
  embeat: { short: "AI", full: "AI 推荐" },
};

export const getMusicSourceLabel = (
  source: string,
  variant: "short" | "full" = "short",
): string => SOURCE_LABELS[source]?.[variant] || source;
