import { beforeEach, describe, expect, it, vi } from 'vitest';
import { platformAccounts, importedPlatformSongs, accountPlatformName } from '../platformAccounts';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../ipc', () => ({ invokeCommand: invoke }));
beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));

describe('platform account service', () => {
  it('uses native IPC for every authenticated operation', async () => {
    await platformAccounts.list();
    await platformAccounts.start('netease');
    await platformAccounts.finish('netease', 'attempt');
    await platformAccounts.cancel('netease', 'attempt');
    await platformAccounts.refresh('qq');
    await platformAccounts.logout('qq');
    await platformAccounts.playlists('qq');
    await platformAccounts.import('qq', 'playlist');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'list_platform_accounts', 'start_platform_login', 'finish_platform_login', 'cancel_platform_login',
      'refresh_platform_account', 'logout_platform_account', 'list_platform_playlists', 'import_platform_playlist',
    ]);
    expect(invoke.mock.lastCall).toEqual(['import_platform_playlist', { platform: 'qq', playlistId: 'playlist' }]);
    expect(accountPlatformName('qq')).toBe('QQ 音乐');
  });

  it('preserves QQ media identity and omits null song fields for the library', () => {
    const songs = importedPlatformSongs({ name: 'fixture', songs: [
      { id: 'mid', source: 'qq', name: 'fixture', artist: 'artist', album: 'album', pic: 'https://y.gtimg.cn/a.jpg', lyricId: '123', strMediaMid: 'media' },
      { id: '1', source: 'netease', name: 'empty', artist: '', album: '', pic: null, lyricId: null, strMediaMid: null },
    ] });
    expect(songs[0]).toMatchObject({ id: 'mid', lyricId: '123', strMediaMid: 'media' });
    expect(songs[1]).not.toHaveProperty('pic');
    expect(JSON.stringify(songs)).not.toMatch(/cookie|session/);
  });
});
