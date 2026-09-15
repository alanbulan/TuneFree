import type { ParsedSongFull } from '../resolver';
import type { SongMeta } from '../resolverMatch';
import type { Song, TopList } from '../../types';

/**
 * 通用解析层：内置平台、GD 音乐台、酷狗/咪咕搜索、用户导入的洛雪音源，
 * 都实现同一套 provider 接口；`resolver.ts` 与搜索接口只面向接口编排。
 *
 * **平台清单由 provider 自己声明**（`platforms` / `searchPlatforms` / `topListPlatforms`），
 * 调用方不再维护任何写死的平台分支。
 */

/** 一次解析请求：平台 + 歌曲标识 + 音质，附带可用于按歌名匹配的元数据。 */
export interface SourceResolveRequest {
  platform: string;
  id: string | number;
  quality: string;
  name?: string;
  artist?: string;
  album?: string;
  /** 平台侧文件 hash（酷狗等）。 */
  hash?: string;
  /** 平台侧专辑 id。 */
  albumId?: string;
  /** QQ 媒体文件 MID，不能用歌曲 MID 代替。 */
  strMediaMid?: string;
  /** 歌曲在平台侧的封面 / 播放 / 歌词标识（GD 专属平台需要）。 */
  picId?: string | number;
  urlId?: string | number;
  lyricId?: string | number;
  /** 音质 → hash 映射，透传给洛雪脚本的 `musicInfo._types`。 */
  qualityHashes?: Record<string, { hash?: string; size?: number }>;
  /** 跳过 provider 内部缓存（播放恢复链路的 refresh 会用到）。 */
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

/** provider 类别，用于日志与音源管理页展示。 */
export type ProviderKind = 'native' | 'gdstudio' | 'lx';

/** 统一的音源 provider。方法都是可选的：提供哪个方法就代表有哪个能力。 */
export interface MusicProvider {
  readonly kind: ProviderKind;
  /** 稳定标识：内置为 'native' / 'gdstudio' / 'kugou-migu-search'，自定义为 'lx:<scriptId>:<平台>'。 */
  readonly id: string;
  /** 展示名，用于日志与音源管理页。 */
  readonly label: string;
  /** 该 provider 负责的平台（解析与歌词都以此为界）。 */
  readonly platforms: readonly string[];
  /** 提供搜索的平台子集；缺省表示不提供搜索。 */
  readonly searchPlatforms?: readonly string[];
  /** 提供榜单的平台子集；缺省表示不提供榜单。 */
  readonly topListPlatforms?: readonly string[];
  /** 解析优先级，数字小者优先（仅内置 provider 之间比较）。 */
  readonly priority?: number;
  /** 歌词优先级，缺省沿用 `priority`；原生歌词优先于 GD 就是靠它表达。 */
  readonly lyricsPriority?: number;
  /** 聚合搜索分组：core 常参与，extended 由「扩展源」开关控制。 */
  readonly searchTier?: 'core' | 'extended';
  /** 是否占用 GD 音乐台公开接口频次（界面提示用）。 */
  readonly gdStudioQuota?: boolean;
  /** 跨源兜底参与方式：true 总是参与，'with-custom' 仅在存在自定义音源时参与。 */
  readonly fallback?: boolean | 'with-custom';
  /** 允许在缺少平台 id 时按歌名 + 歌手尝试解析（自定义源专用）。 */
  readonly nameMatch?: boolean;

  /** 返回可直接播放的 URL；失败或不可用返回 null。 */
  getUrl?(request: SourceResolveRequest): Promise<string | null>;
  /** 返回歌词文本。 */
  getLyrics?(request: SourceResolveRequest): Promise<string>;
  /** 返回封面地址。 */
  getPic?(request: SourceResolveRequest): Promise<string>;
  /** 一次性拿到 url + 歌词 + 封面（GD 的 joox / bilibili 走这种模式）。 */
  resolveFull?(request: SourceResolveRequest): Promise<ParsedSongFull | null>;
  /** 搜索；`platform` 必然是 `searchPlatforms` 之一。 */
  search?(
    keyword: string,
    platform: string,
    page: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Song[]>;
  topLists?(platform: string): Promise<TopList[]>;
  topListDetail?(id: string | number, platform: string): Promise<Song[]>;
}

/** 该 provider 是否负责某个平台（解析 / 歌词）。 */
export const providerHandles = (provider: MusicProvider, platform: string): boolean =>
  provider.platforms.includes(platform);

/** 该 provider 是否为某个平台提供搜索。 */
export const providerSearches = (provider: MusicProvider, platform: string): boolean =>
  provider.search !== undefined && (provider.searchPlatforms?.includes(platform) ?? false);

/** 该 provider 是否为某个平台提供榜单。 */
export const providerLists = (provider: MusicProvider, platform: string): boolean =>
  provider.topLists !== undefined && (provider.topListPlatforms?.includes(platform) ?? false);

/** 从 Song 上摘出解析请求所需的最小元数据。 */
export const toSourceResolveRequest = (
  song: Pick<Song, 'id' | 'source'> & SongMeta,
  quality: string,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
): SourceResolveRequest => ({
  platform: String(song.source || ''),
  id: song.id,
  quality,
  name: song.name,
  artist: song.artist,
  album: song.album,
  hash: song.hash,
  albumId: song.albumId,
  strMediaMid: song.strMediaMid,
  qualityHashes: song.qualityHashes,
  picId: song.picId,
  urlId: song.urlId,
  lyricId: song.lyricId,
  forceRefresh: options.forceRefresh,
  signal: options.signal,
});
