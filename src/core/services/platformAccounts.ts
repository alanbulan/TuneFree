import { invokeCommand, type AccountPlatform, type PlatformPlaylistImport } from '../ipc';
import type { Song } from '../types';
import { invalidatePlayback } from './sources/generation';

const accountChanged = <T>(result: T): T => { invalidatePlayback(); return result; };

export const ACCOUNT_PLATFORMS: readonly { id: AccountPlatform; name: string }[] = [
  { id: 'netease', name: '网易云音乐' },
  { id: 'qq', name: 'QQ 音乐' },
  { id: 'kuwo', name: '酷我音乐' },
];

export const accountPlatformName = (platform: AccountPlatform): string =>
  ACCOUNT_PLATFORMS.find((item) => item.id === platform)!.name;

/** No authenticated fetches in the renderer: all account operations use typed IPC. */
export const platformAccounts = {
  list: () => invokeCommand('list_platform_accounts'),
  retryAccess: () => invokeCommand('retry_platform_account_access'),
  start: (platform: AccountPlatform) => invokeCommand('start_platform_login', { platform }),
  finish: async (platform: AccountPlatform, attemptId: string) => {
    const result = await invokeCommand('finish_platform_login', { platform, attemptId });
    if (result.state === 'connected') accountChanged(result);
    return result;
  },
  cancel: (platform: AccountPlatform, attemptId: string) => invokeCommand('cancel_platform_login', { platform, attemptId }),
  refresh: (platform: AccountPlatform) => invokeCommand('refresh_platform_account', { platform }).then(accountChanged),
  logout: (platform: AccountPlatform) => invokeCommand('logout_platform_account', { platform }).then(accountChanged),
  playlists: (platform: AccountPlatform) => invokeCommand('list_platform_playlists', { platform }),
  import: (platform: AccountPlatform, playlistId: string) => invokeCommand('import_platform_playlist', { platform, playlistId }),
  preview: (platform: AccountPlatform, playlistId: string, page: number) => invokeCommand('preview_platform_playlist', { platform, playlistId, page }),
};

export const importedPlatformSongs = (payload: Pick<PlatformPlaylistImport, 'songs'> & { name?: string }): Song[] => payload.songs.map((song) => ({
  id: song.id, source: song.source, name: song.name, artist: song.artist, album: song.album,
  ...(song.pic ? { pic: song.pic } : {}),
  ...(song.lyricId ? { lyricId: song.lyricId } : {}),
  ...(song.strMediaMid ? { strMediaMid: song.strMediaMid } : {}),
}));
