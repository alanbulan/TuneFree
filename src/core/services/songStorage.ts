import type { Song } from '../types';
import { stableMusicUrl } from './musicUrl';

/** 保存稳定身份和展示信息；播放链接、歌词及推荐上下文在运行时重新获取。 */
export const stripRuntimeSongFields = (song: Song): Song => ({
  id: song.id,
  source: song.source,
  name: song.name,
  artist: song.artist,
  album: song.album,
  ...(song.pic ? { pic: stableMusicUrl(song.pic) } : {}),
  ...(song.picId ? { picId: song.picId } : {}),
  ...(song.urlId ? { urlId: song.urlId } : {}),
  ...(song.lyricId ? { lyricId: song.lyricId } : {}),
  ...(song.types ? { types: song.types } : {}),
});
