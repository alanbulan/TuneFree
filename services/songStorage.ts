import type { Song } from '../types';
import { stableMusicUrl } from './musicUrl';

/**
 * 持久化前去掉运行时字段（播放地址、歌词、推荐上下文等）。
 * 这些内容要么带一次性签名会过期，要么体积大，要么属于隐私数据，
 * 重新打开时按稳定身份重新获取即可。封面地址里的历史代理也要还原。
 */
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
