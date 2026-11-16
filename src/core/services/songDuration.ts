/** 平台录音时长统一为秒；不猜酷我榜单的 duration（该字段实际是类型值）。 */
export const readSongDuration = (raw: unknown, milliseconds = false): number | undefined => {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const text = String(raw).trim();
  const parts = text.split(':');
  let seconds: number;
  if (parts.length > 1) {
    if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))
      || parts.slice(1).some((part) => Number(part) >= 60)) return undefined;
    seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  } else {
    seconds = Number(text) / (milliseconds ? 1000 : 1);
  }
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

export const getPlatformSongDuration = (raw: Record<string, unknown>, platform: string): number | undefined =>
  readSongDuration(raw.durationSeconds)
  ?? (platform === 'netease' ? readSongDuration(raw.dt, true) ?? readSongDuration(raw.duration, true)
    : platform === 'qq' ? readSongDuration(raw.interval)
      : platform === 'kuwo' ? readSongDuration(raw.song_duration) ?? readSongDuration(raw.DURATION)
        ?? readSongDuration(raw.songTimeMinutes)
        : undefined);
