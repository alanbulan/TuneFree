import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { deferred } from '../../../../../core/__tests__/deferred';
import type { PlatformPlaylistPreview } from '../../../../../core/ipc';
import PlaylistPreview from '../PlaylistPreview';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), play: vi.fn(), toggle: vi.fn(), togglePlay: vi.fn(), favorite: false, playing: false, currentSong: null as { id: string; source: string; name: string; artist: string; album: string } | null, toast: vi.fn() }));
vi.mock('../../../../../core/services/platformAccounts', async (original) => ({ ...await original<typeof import('../../../../../core/services/platformAccounts')>(), platformAccounts: { preview: mocks.preview } }));
vi.mock('../../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play, togglePlay: mocks.togglePlay }),
  usePlayerNowPlaying: () => ({ currentSong: mocks.currentSong, isPlaying: mocks.playing }) }));
vi.mock('../../../../../core/contexts/LibraryContext', () => ({ useLibrary: () => ({ toggleFavorite: mocks.toggle, isFavorite: () => mocks.favorite }) }));
vi.mock('../../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
const payload: PlatformPlaylistPreview = { name: 'preview', page: 1, pageSize: 20, total: 21,
  songs: [{ id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '专辑', lyricId: '123', strMediaMid: 'MEDIA', pic: null }] };
function props(): ComponentProps<typeof PlaylistPreview> { return { account: { platform: 'qq', userId: '1', nickname: 'fixture', avatarUrl: null, state: 'connected', connectedAt: 1 },
  playlist: { id: '42', name: 'preview', coverUrl: null, kind: 'created', trackCount: 21 }, busy: false, onClose: vi.fn(), onImport: vi.fn(), markExpired: vi.fn() }; }
const settle = async () => { await act(async () => {}); };
beforeEach(() => { vi.clearAllMocks(); mocks.favorite = false; mocks.currentSong = null; mocks.playing = false; mocks.preview.mockReset().mockResolvedValue(payload); mocks.toggle.mockReturnValue(true); });
afterEach(cleanup);
it('plays and favorites directly from the shared song table without importing the playlist', async () => {
  const model = props(); render(<PlaylistPreview {...model} />); await settle();
  const song = { id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '专辑', lyricId: '123', strMediaMid: 'MEDIA' };
  expect(document.querySelector('.song-table .table-head')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('音乐 - 歌手')); expect(mocks.play).toHaveBeenCalledWith([song], song);
  fireEvent.click(screen.getByRole('button', { name: '播放本页' })); expect(mocks.play).toHaveBeenLastCalledWith([song]);
  expect(model.onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 音乐' })); expect(mocks.toggle).toHaveBeenCalledWith(song);
  expect(mocks.toast).toHaveBeenLastCalledWith('已收藏歌曲', 'success');
  mocks.favorite = true; fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 音乐' })); expect(mocks.toast).toHaveBeenLastCalledWith('已取消收藏', 'success');
  mocks.toggle.mockReturnValueOnce(false); fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 音乐' })); expect(mocks.toast).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '歌曲下一页' })); await settle(); expect(mocks.preview).toHaveBeenLastCalledWith('qq', '42', 2);
  fireEvent.click(screen.getByRole('button', { name: '导入这个歌单' })); expect(model.onImport).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '关闭' })); expect(model.onClose).toHaveBeenCalledOnce();
});
it('reports failed pages and retries them, ignores stale responses and marks expired accounts', async () => {
  const model = props(); const pending = deferred<PlatformPlaylistPreview>(); mocks.preview.mockReturnValueOnce(pending.promise);
  const view = render(<PlaylistPreview {...model} />); await settle(); expect(screen.getByRole('status').textContent).toContain('正在读取');
  view.unmount(); await act(async () => pending.resolve(payload));
  mocks.preview.mockRejectedValueOnce(new Error('网络失败')); render(<PlaylistPreview {...model} />); await settle();
  expect(screen.getByRole('alert').textContent).toBe('网络失败');
  fireEvent.click(screen.getByRole('button', { name: '重新读取歌曲' })); await settle(); expect(screen.getByLabelText('音乐 - 歌手')).toBeTruthy();
  mocks.preview.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: '账号已失效' });
  fireEvent.click(screen.getByRole('button', { name: '歌曲下一页' })); await settle(); expect(model.markExpired).toHaveBeenCalledWith('qq');
});
it('empty or busy previews cannot import and empty previews cannot play', async () => {
  mocks.preview.mockResolvedValueOnce({ ...payload, total: 0, songs: [] }); const model = props(); model.playlist.kind = 'collected';
  render(<PlaylistPreview {...model} busy />); await settle(); expect(screen.getByText('这份歌单没有可读取的歌曲。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '播放本页' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '导入这个歌单' }) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps pause and resume available inside the modal for platform playback', async () => {
  mocks.currentSong = { id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '' }; mocks.playing = true;
  const model = props(); const view = render(<PlaylistPreview {...model} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '暂停播放' })); expect(mocks.togglePlay).toHaveBeenCalledOnce();
  mocks.playing = false; view.rerender(<PlaylistPreview {...model} />);
  fireEvent.click(screen.getByRole('button', { name: '继续播放' })); expect(mocks.togglePlay).toHaveBeenCalledTimes(2);
});
