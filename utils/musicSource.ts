export const MUSIC_SOURCES = [
  "netease",
  "qq",
  "kuwo",
  "tidal",
  "qobuz",
  "joox",
  "bilibili",
  "apple",
  "ytmusic",
  "spotify",
] as const;

export type MusicSource = (typeof MUSIC_SOURCES)[number];
export type GdStudioApiSource =
  | "netease"
  | "tencent"
  | "kuwo"
  | "tidal"
  | "qobuz"
  | "joox"
  | "bilibili"
  | "apple"
  | "ytmusic"
  | "spotify";

export const NATIVE_MUSIC_SOURCES = ["netease", "qq", "kuwo"] as const;

export const GD_STUDIO_ONLY_SOURCES = [
  "tidal",
  "qobuz",
  "joox",
  "bilibili",
  "apple",
  "ytmusic",
  "spotify",
] as const;

export const GD_STUDIO_SEARCHABLE_ONLY_SOURCES = ["joox", "bilibili"] as const;

export const SEARCHABLE_MUSIC_SOURCES = [
  ...NATIVE_MUSIC_SOURCES,
  ...GD_STUDIO_SEARCHABLE_ONLY_SOURCES,
] as const;

export const AGGREGATE_MUSIC_SOURCES = SEARCHABLE_MUSIC_SOURCES;
export const GD_STUDIO_ATTRIBUTION = "GD音乐台 (music.gdstudio.xyz)";
export const GD_STUDIO_RATE_LIMIT_HINT = "5 分钟内不超过 50 次请求";

const SOURCE_LABELS: Record<MusicSource, { short: string; full: string }> = {
  netease: { short: "网易云", full: "网易云" },
  qq: { short: "QQ", full: "QQ音乐" },
  kuwo: { short: "酷我", full: "酷我音乐" },
  tidal: { short: "TIDAL", full: "TIDAL" },
  qobuz: { short: "Qobuz", full: "Qobuz" },
  joox: { short: "JOOX", full: "JOOX" },
  bilibili: { short: "B站", full: "哔哩哔哩" },
  apple: { short: "Apple", full: "Apple Music" },
  ytmusic: { short: "YT Music", full: "YouTube Music" },
  spotify: { short: "Spotify", full: "Spotify" },
};

const SOURCE_BADGE_CLASSES: Record<MusicSource, string> = {
  netease: "bg-red-100 text-red-600",
  qq: "bg-green-100 text-green-600",
  kuwo: "bg-yellow-100 text-yellow-700",
  tidal: "bg-blue-100 text-blue-700",
  qobuz: "bg-cyan-100 text-cyan-700",
  joox: "bg-purple-100 text-purple-700",
  bilibili: "bg-pink-100 text-pink-700",
  apple: "bg-gray-900 text-white",
  ytmusic: "bg-red-100 text-red-700",
  spotify: "bg-emerald-100 text-emerald-700",
};

const SOURCE_SET = new Set<string>(MUSIC_SOURCES);
const NATIVE_SOURCE_SET = new Set<string>(NATIVE_MUSIC_SOURCES);
const GD_STUDIO_ONLY_SOURCE_SET = new Set<string>(GD_STUDIO_ONLY_SOURCES);
const SEARCHABLE_SOURCE_SET = new Set<string>(SEARCHABLE_MUSIC_SOURCES);

const GD_STUDIO_API_SOURCE_MAP: Record<MusicSource, GdStudioApiSource> = {
  netease: "netease",
  qq: "tencent",
  kuwo: "kuwo",
  tidal: "tidal",
  qobuz: "qobuz",
  joox: "joox",
  bilibili: "bilibili",
  apple: "apple",
  ytmusic: "ytmusic",
  spotify: "spotify",
};

export const SEARCH_SOURCE_OPTIONS = SEARCHABLE_MUSIC_SOURCES.map((source) => ({
  value: source,
  label: SOURCE_LABELS[source].full,
  disabled: false,
}));

export const normalizeMusicSource = (source: string): string =>
  source === "tencent" ? "qq" : source;

export const isMusicSource = (source: string): boolean =>
  SOURCE_SET.has(normalizeMusicSource(source));

export const isNativeMusicSource = (source: string): boolean =>
  NATIVE_SOURCE_SET.has(normalizeMusicSource(source));

export const isGDStudioSource = (source: string): boolean =>
  SOURCE_SET.has(normalizeMusicSource(source));

export const isGDStudioOnlySource = (source: string): boolean =>
  GD_STUDIO_ONLY_SOURCE_SET.has(normalizeMusicSource(source));

export const isSearchableMusicSource = (source: string): boolean =>
  SEARCHABLE_SOURCE_SET.has(normalizeMusicSource(source));

export const toGDStudioApiSource = (source: string): GdStudioApiSource => {
  const normalized = normalizeMusicSource(source);
  if (!SOURCE_SET.has(normalized)) return normalized as GdStudioApiSource;
  return GD_STUDIO_API_SOURCE_MAP[normalized as MusicSource];
};

export const getMusicSourceLabel = (
  source: string,
  variant: "short" | "full" = "short",
): string => {
  const normalized = normalizeMusicSource(source);
  return SOURCE_SET.has(normalized)
    ? SOURCE_LABELS[normalized as MusicSource][variant]
    : source;
};

export const getMusicSourceBadgeClass = (source: string): string => {
  const normalized = normalizeMusicSource(source);
  return SOURCE_SET.has(normalized)
    ? SOURCE_BADGE_CLASSES[normalized as MusicSource]
    : "bg-gray-200 text-gray-600";
};
