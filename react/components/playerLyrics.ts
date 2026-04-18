import { ParsedLyric } from "../types";

export const parseLrc = (lrc: string): ParsedLyric[] => {
  if (!lrc) return [];
  const lines = lrc.split("\n");
  const raw: { time: number; text: string }[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lines) {
    const matches = Array.from(line.matchAll(timeExp));
    if (matches.length === 0) continue;

    const text = line.replace(timeExp, "").trim();
    if (!text) continue;

    for (const match of matches) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const msStr = match[3];
      const msVal = parseInt(msStr, 10);
      const ms = msStr.length === 2 ? msVal * 10 : msVal;
      const time = min * 60 + sec + ms / 1000;

      raw.push({ time, text });
    }
  }

  raw.sort((a, b) => a.time - b.time);

  const result: ParsedLyric[] = [];
  for (const item of raw) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.time - item.time) < 0.5) {
      if (!last.translation && last.text !== item.text) {
        last.translation = item.text;
      }
    } else {
      result.push({ time: item.time, text: item.text });
    }
  }

  return result;
};

export const findActiveLyricIndex = (
  lyrics: ParsedLyric[],
  currentTime: number,
): number => {
  if (lyrics.length === 0) return 0;

  let lo = 0;
  let hi = lyrics.length - 1;
  let result = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lyrics[mid].time <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
};
