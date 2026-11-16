export interface LyricSongIdentity {
  name?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
}

const comparable = (value?: string): string => (value || '').normalize('NFKC').toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');
const unknown = (value?: string): boolean => !value?.trim()
  || /^(?:unknown (?:song|artist)|未知(?:歌曲|歌手))$/i.test(value.trim());
const artists = (value?: string): string[] => (value || '')
  .split(/[,&，、/\\|;；]+|\s+(?:and|feat\.?|ft\.?)\s+/i).map(comparable).filter(Boolean);

/** 精确标题与真实歌手、演唱版本同时核对；Love 不能匹配 Love Story。 */
export const matchesLyricSongIdentity = (
  candidate: LyricSongIdentity,
  target: LyricSongIdentity,
  strictArtist = true,
): boolean => {
  if (unknown(target.name) || unknown(candidate.name)) return false;
  // 括号里的演出地点、混音者、版本年份也是录音身份；不能只保留 Live/Remix 类型。
  const left = comparable(candidate.name), right = comparable(target.name);
  if (!left || left !== right) return false;
  const wantedArtists = [...new Set(artists(target.artist))], actualArtists = [...new Set(artists(candidate.artist))];
  if (wantedArtists.length === 0 || unknown(target.artist)) return !strictArtist;
  if (actualArtists.length === 0 || unknown(candidate.artist)) return false;
  return wantedArtists.length === actualArtists.length
    && wantedArtists.every((artist) => actualArtists.includes(artist));
};

export const matchesLyricDuration = (candidate?: number, target?: number): boolean =>
  Number.isFinite(candidate) && Number.isFinite(target) && (candidate || 0) > 0 && (target || 0) > 0
  && Math.abs((candidate as number) - (target as number)) <= 2;

/** 专辑只作排序依据：同一录音在精选集里仍有效，版本和时长必须另行通过。 */
export const sameLyricAlbum = (left?: string, right?: string): boolean =>
  !!comparable(left) && comparable(left) === comparable(right);
