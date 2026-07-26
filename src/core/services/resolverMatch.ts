import type { Song } from "../types";

// 跨音源 fallback 的候选匹配与并发调度工具（resolver.ts 专用）。

export type SongMeta = Pick<Song, "pic" | "picId" | "urlId" | "lyricId"> &
  Partial<Pick<Song, "name" | "artist" | "album">>;

export const abortReasonError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");

/**
 * 并发跑 worker、返回第一个非 null 结果。
 * - 内部 controller 在有人成功后 abort 其余 worker 的 fetch；
 * - externalSignal（调用方取消）触发时整体 reject，不会被当作"全部失败"。
 */
export const firstSuccessfulWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  timeoutMs: number,
  worker: (item: T, signal: AbortSignal) => Promise<R | null>,
  externalSignal?: AbortSignal,
): Promise<R | null> => {
  if (externalSignal?.aborted) {
    throw abortReasonError(externalSignal);
  }
  if (items.length === 0) return null;

  return new Promise((resolve, reject) => {
    let nextIndex = 0;
    let activeCount = 0;
    let settled = false;
    const controller = new AbortController();

    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      controller.abort(externalSignal?.aborted ? externalSignal.reason : undefined);
      complete();
    };

    const finish = (result: R | null) => settle(() => resolve(result));
    const onExternalAbort = () =>
      settle(() => reject(abortReasonError(externalSignal!)));

    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    const launch = () => {
      while (
        !settled &&
        activeCount < concurrency &&
        nextIndex < items.length
      ) {
        const item = items[nextIndex++];
        activeCount += 1;

        void worker(item, controller.signal)
          .then((result) => {
            activeCount -= 1;
            if (settled) return;
            if (result !== null) {
              finish(result);
              return;
            }
            if (nextIndex >= items.length && activeCount === 0) {
              finish(null);
              return;
            }
            launch();
          })
          .catch(() => {
            activeCount -= 1;
            if (settled) return;
            if (nextIndex >= items.length && activeCount === 0) {
              finish(null);
              return;
            }
            launch();
          });
      }
    };

    const timeoutId = setTimeout(() => finish(null), timeoutMs);
    launch();
  });
};

export const hasPlayableId = (id: string | number | undefined | null): boolean => {
  const normalized = id === null || id === undefined ? "" : String(id).trim();
  return !!normalized && !normalized.startsWith("temp_");
};

const normalizeComparableText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[\s·・.。\-_—–,，、/\\|:：]+/g, "")
    .trim();
};

const isUnknownText = (value: unknown): boolean => {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "unknown song" || text === "unknown artist";
};

const splitArtistTokens = (artist: unknown): string[] =>
  String(artist || "")
    .split(/[,&，、/\\|]+|\s+(?:and|feat\.?|ft\.?)\s+/i)
    .map(normalizeComparableText)
    .filter((token) => token.length > 1);

export const buildFallbackQuery = (songMeta?: SongMeta): string => {
  if (!songMeta || isUnknownText(songMeta.name)) return "";
  const parts = [songMeta.name];
  if (!isUnknownText(songMeta.artist)) parts.push(songMeta.artist);
  return parts.join(" ").trim();
};

export const isLikelySameSong = (candidate: Song, songMeta?: SongMeta): boolean => {
  if (!songMeta || isUnknownText(songMeta.name)) return true;

  const targetName = normalizeComparableText(songMeta.name);
  const candidateName = normalizeComparableText(candidate.name);
  if (!targetName || !candidateName) return false;

  const nameMatches =
    candidateName === targetName ||
    candidateName.includes(targetName) ||
    targetName.includes(candidateName);
  if (!nameMatches) return false;

  const targetArtists = splitArtistTokens(songMeta.artist);
  if (targetArtists.length === 0) return true;

  const candidateArtist = normalizeComparableText(candidate.artist);
  if (!candidateArtist) return true;

  return targetArtists.some(
    (artist) => candidateArtist.includes(artist) || artist.includes(candidateArtist),
  );
};
