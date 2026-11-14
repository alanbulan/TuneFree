import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSongUrl, parseSongFull } from '../resolver';
import { registerBuiltinProviders, setCustomProviders } from '../sources/registry';
import { BUILTIN_PROVIDERS } from '../sources/builtin';
const account = vi.hoisted(() => vi.fn());
vi.mock('../accountResolution', () => ({ resolveAccountUrl: account }));
const script = { kind: 'lx' as const, id: 'lx:fixture', label: 'fixture', platforms: ['netease'],
  getUrl: vi.fn(), getLyrics: vi.fn(), getPic: vi.fn(), resolveFull: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); registerBuiltinProviders([]); setCustomProviders([{ platform: 'netease', provider: script }]);
  script.getUrl.mockResolvedValue('https://script.test/a.mp3'); script.getLyrics.mockResolvedValue('歌词'); script.getPic.mockResolvedValue('封面');
  script.resolveFull.mockResolvedValue({ url: 'https://script.test/full.mp3', lrc: '', pic: '', resolvedSource: 'netease' });
  account.mockResolvedValue({ url: 'https://m701.music.126.net/account.mp3', quality: '128k', state: 'connected' });
});
afterEach(() => { registerBuiltinProviders(BUILTIN_PROVIDERS); setCustomProviders([]); });
it('account wins before both script URL and full-song resolution without a selected music script', async () => {
  expect(await getSongUrl(1, 'netease', '320k')).toBe('https://m701.music.126.net/account.mp3');
  expect(await parseSongFull(1, 'netease', '320k', { pic: 'https://cover.test/a.jpg', lyricId: 'LRC' }, { deferMetadata: true }))
    .toMatchObject({ url: 'https://m701.music.126.net/account.mp3', playbackAccount: 'netease', playbackQuality: '128k', lrc: '', pic: 'https://cover.test/a.jpg', resolvedLyricId: 'LRC' });
  expect(script.getUrl).not.toHaveBeenCalled(); expect(script.resolveFull).not.toHaveBeenCalled();
  setCustomProviders([]);
  expect(await getSongUrl(1, 'netease')).toBe('https://m701.music.126.net/account.mp3');
});
it('account resolution keeps existing lyrics and missing quality optional', async () => {
  account.mockResolvedValue({ url: 'https://m701.music.126.net/account.mp3' });
  expect(await parseSongFull(1, 'netease')).toMatchObject({ lrc: '歌词', pic: '' });
});
it('unavailable and rejected account URLs continue to script full and URL paths once', async () => {
  const options = { rejectedUrls: ['https://m701.music.126.net/account.mp3'], deferMetadata: true };
  expect(await parseSongFull(1, 'netease', '320k', undefined, options)).toMatchObject({ url: 'https://script.test/full.mp3' });
  expect(await getSongUrl(1, 'netease', '320k', undefined, options)).toBe('https://script.test/a.mp3');
  account.mockResolvedValue({ url: null, message: '账号已失效' });
  script.resolveFull.mockResolvedValue(null); script.getUrl.mockResolvedValue(null); script.getPic.mockResolvedValue('');
  expect(await parseSongFull(1, 'netease', '320k', undefined, { deferMetadata: true })).toMatchObject({ url: null, playbackNotice: '账号已失效' });
  script.resolveFull.mockResolvedValue({ url: null, pic: '', lrc: '', resolvedSource: 'netease' });
  expect(await parseSongFull(1, 'netease')).toMatchObject({ playbackNotice: '账号已失效' });
});
it('cross-platform matching keeps the account and actual quality of the song that starts playback', async () => {
  setCustomProviders([]);
  registerBuiltinProviders([{ kind: 'native', id: 'fixture:qq', label: 'QQ fixture', platforms: ['qq'],
    searchPlatforms: ['qq'], fallback: true,
    search: async () => [{ id: 'QQMID', source: 'qq', name: '同一首歌', artist: '同一歌手', album: '专辑' }] }]);
  account.mockImplementation(async (request) => request.platform === 'qq'
    ? { url: 'https://ws.stream.qqmusic.qq.com/account.mp3', quality: '128k', state: 'connected' }
    : { url: null, quality: null, state: 'not_connected' });
  expect(await parseSongFull(1, 'netease', '320k', { name: '同一首歌', artist: '同一歌手' }, { deferMetadata: true }))
    .toMatchObject({ resolvedSource: 'qq', resolvedId: 'QQMID', playbackAccount: 'qq', playbackQuality: '128k' });
});
