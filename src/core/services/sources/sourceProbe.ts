import { getMusicSourceSandbox } from './manager';
import { buildMusicInfo, pickQuality } from './platformMap';
import type { MusicSourceEntry } from './sourceEntry';
import type { SourceResolveRequest } from './types';

/**
 * 音源主动检测（音源管理页「一键检测」）。
 *
 * 解析链路按用户排序接力，只会用到第一个成功的音源，其余音源永远停在「待验证」。
 * 这里绕过 registry 直接调用单个音源沙箱的 `musicUrl`：
 * - 不经过熔断器，检测失败不会把正常播放要用的通道摘掉；
 * - 不改音源顺序、不写 provider 的地址缓存；
 * - 沙箱自己会把这次调用记进诊断（成功 / 失败原因 / 耗时），界面状态随之刷新。
 */

/**
 * 每个平台一首检测用歌曲：统一选 BEYOND《海阔天空》（各平台均在架、标识稳定）。
 * 只测「第一个支持的平台」：按下方顺序取音源声明了播放地址的第一个平台，
 * 一个音源只发一次请求，15 个音源也只是 15 次调用；想看逐平台结果仍以实际播放记录为准。
 * 音质请求 128k（只要地址，不下载音频）；脚本没声明 128k 时沿用解析链路的回落规则。
 */
const PROBE_SONGS: Readonly<Record<string, SourceResolveRequest>> = {
  netease: { platform: 'netease', id: '1357375695', quality: '128k', name: '海阔天空', artist: 'Beyond', album: '华纳廿三周年纪念精选系列' },
  qq: { platform: 'qq', id: '001yS0N33yPm1B', strMediaMid: '002MX8Ea4e5RDS', quality: '128k', name: '海阔天空', artist: 'BEYOND', album: '乐与怒' },
  kuwo: { platform: 'kuwo', id: '5886682', quality: '128k', name: '海阔天空', artist: 'BEYOND', album: '乐与怒' },
  kugou: {
    platform: 'kugou', id: 'c41e80a18d1448fa47086372999c7f43', hash: 'c41e80a18d1448fa47086372999c7f43', albumId: '973001',
    quality: '128k', name: '海阔天空', artist: 'BEYOND', album: '乐与怒',
    qualityHashes: {
      '128k': { hash: 'c41e80a18d1448fa47086372999c7f43' },
      '320k': { hash: '0d04734e75820beae8aa202e758931db' },
      flac: { hash: 'ef79af82f05aa5242ab2aaa22ca7de78' },
    },
  },
  migu: { platform: 'migu', id: '6005752DXKE', quality: '128k', name: '海阔天空', artist: 'Beyond', album: 'Beyond 24K Mastersonic Compilation' },
};

/** 平台检测顺序：网易、QQ、酷我最常见，放前面。 */
const PROBE_PLATFORM_ORDER = ['netease', 'qq', 'kuwo', 'kugou', 'migu'];

/** 同时检测的音源数：每次检测都会让脚本发网络请求，别一次全放出去。 */
export const PROBE_CONCURRENCY = 3;

export interface SourceProbeResult {
  id: string;
  ok: boolean;
  /** 没有可检测的平台（例如只声明了 joox / 哔哩哔哩），不算失败。 */
  skipped: boolean;
  message: string;
  durationMs: number;
}

/** 该音源用哪个平台检测；没有检测歌曲可用时返回 null。 */
export const pickProbePlatform = (entry: MusicSourceEntry) => {
  for (const platform of PROBE_PLATFORM_ORDER) {
    const declared = entry.platforms.find((item) => item.appPlatform === platform && item.actions.includes('musicUrl'));
    if (declared) return declared;
  }
  return null;
};

/** 检测单个音源：用检测歌曲真实解析一次播放地址。取消时抛出中止错误。 */
export const probeMusicSource = async (entry: MusicSourceEntry, signal?: AbortSignal): Promise<SourceProbeResult> => {
  const id = entry.record.id;
  const platform = pickProbePlatform(entry);
  if (!platform) return { id, ok: false, skipped: true, message: '没有可检测的平台', durationMs: 0 };
  const sandbox = getMusicSourceSandbox(id);
  if (!sandbox) return { id, ok: false, skipped: false, message: '音源未运行，请先启用或重新加载', durationMs: 0 };
  const song = PROBE_SONGS[platform.appPlatform];
  const startedAt = Date.now();
  const outcome = await sandbox.call(
    platform.lxPlatform,
    'musicUrl',
    { type: pickQuality(song.quality, platform.qualitys) ?? song.quality, musicInfo: buildMusicInfo(song) },
    { signal },
  );
  return {
    id, ok: outcome.ok, skipped: false,
    message: outcome.ok ? '返回有效播放地址' : outcome.error || '音源调用失败',
    durationMs: Date.now() - startedAt,
  };
};

/**
 * 限并发地检测一批音源。`onProgress` 在每个音源开始 / 结束时回调（已完成数、进行中的 id）。
 * 取消后不再启动新的检测，进行中的调用随信号中止，只返回已完成的结果。
 */
export const probeMusicSources = async (
  entries: MusicSourceEntry[],
  options: { signal?: AbortSignal; concurrency?: number; onProgress?: (done: number, active: string[]) => void } = {},
): Promise<SourceProbeResult[]> => {
  const { signal, concurrency = PROBE_CONCURRENCY, onProgress } = options;
  const queue = [...entries];
  const active = new Set<string>();
  const results: SourceProbeResult[] = [];
  const report = () => onProgress?.(results.length, [...active]);
  const worker = async () => {
    while (queue.length > 0 && !signal?.aborted) {
      const entry = queue.shift()!;
      active.add(entry.record.id);
      report();
      try {
        results.push(await probeMusicSource(entry, signal));
      } catch (error) {
        if (!signal?.aborted) {
          results.push({ id: entry.record.id, ok: false, skipped: false, message: error instanceof Error ? error.message : String(error), durationMs: 0 });
        }
      } finally {
        active.delete(entry.record.id);
        report();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
};
