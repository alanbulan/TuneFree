import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { deferred } from '../../../../../core/__tests__/deferred';
import type { PlatformPlaylistPreview } from '../../../../../core/ipc';
import PlaylistPreview from '../PlaylistPreview';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), import: vi.fn(), play: vi.fn(), toggle: vi.fn(), togglePlay: vi.fn(), favorite: false, playing: false, currentSong: null as { id: string; source: string; name: string; artist: string; album: string } | null, toast: vi.fn() }));
vi.mock('../../../../../core/services/platformAccounts', async (original) => ({ ...await original<typeof import('../../../../../core/services/platformAccounts')>(), platformAccounts: { preview: mocks.preview, import: mocks.import } }));
vi.mock('../../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play, togglePlay: mocks.togglePlay }),
  usePlayerNowPlaying: () => ({ currentSong: mocks.currentSong, isPlaying: mocks.playing }) }));
vi.mock('../../../../../core/contexts/LibraryContext', () => ({ useLibrary: () => ({ toggleFavorite: mocks.toggle, isFavorite: () => mocks.favorite }) }));
vi.mock('../../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
const payload: PlatformPlaylistPreview = { name: 'preview', page: 1, pageSize: 20, total: 21,
  songs: [{ id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '专辑', lyricId: '123', strMediaMid: 'MEDIA', pic: null }] };
function props(): ComponentProps<typeof PlaylistPreview> { return { account: { platform: 'qq', userId: '1', nickname: 'fixture', avatarUrl: null, state: 'connected', connectedAt: 1 },
  playlist: { id: '42', name: 'preview', coverUrl: null, kind: 'created', trackCount: 21 }, busy: false, onClose: vi.fn(), onImport: vi.fn(), markExpired: vi.fn() }; }
const settle = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.favorite = false; mocks.currentSong = null; mocks.playing = false;
  mocks.preview.mockReset().mockResolvedValue(payload); mocks.import.mockReset().mockResolvedValue(payload);
  mocks.play.mockReset().mockResolvedValue(undefined); mocks.toggle.mockReturnValue(true);
});
afterEach(cleanup);
it('plays and favorites directly from the shared song table without importing the playlist', async () => {
  const model = props(); render(<PlaylistPreview {...model} />); await settle();
  const song = { id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '专辑', lyricId: '123', strMediaMid: 'MEDIA' };
  expect(document.querySelector('.song-table .table-head')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('音乐 - 歌手')); await settle(); expect(mocks.play).toHaveBeenCalledWith([song], song);
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle(); expect(mocks.play).toHaveBeenLastCalledWith([song], song);
  expect(mocks.import).toHaveBeenCalledOnce();
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
  const view = render(<PlaylistPreview {...model} />); await settle(); expect(screen.getByText('正在读取第 1 页歌曲…')).toBeTruthy();
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
  expect((screen.getByRole('button', { name: '播放全部' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '导入这个歌单' }) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps cross-page song selection in playlist order and sends only the chosen songs to playback and import', async () => {
  const later = { ...payload.songs[0], id: 'LATER', name: '第二页歌曲' };
  mocks.preview.mockResolvedValueOnce(payload).mockResolvedValueOnce({ ...payload, page: 2, songs: [later] }).mockResolvedValueOnce(payload);
  const model = props(); render(<PlaylistPreview {...model} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '歌曲下一页' })); await settle();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择歌曲 第二页歌曲' }));
  expect(mocks.play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '歌曲上一页' })); await settle();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择本页歌曲' }));
  expect(screen.getByText('已选 2 首')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '播放所选（2）' })); await settle();
  const queue = mocks.play.mock.lastCall![0];
  expect(queue.map((song: { id: string }) => song.id)).toEqual(['MID', 'LATER']);
  expect(mocks.play.mock.lastCall![1]).toEqual(queue[0]);
  fireEvent.click(screen.getByRole('button', { name: '导入所选（2）' })); expect(model.onImport).toHaveBeenCalledWith(queue);
  expect(mocks.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择本页歌曲' })); expect(screen.getByText('已选 1 首')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空选择' })); expect(screen.getByText('已选 0 首')).toBeTruthy();
});
it('loads the whole playlist before starting at a song from a later page and can select every page', async () => {
  const complete = Array.from({ length: 21 }, (_, index) => ({ ...payload.songs[0], id: String(index + 1), name: `歌曲 ${index + 1}` }));
  mocks.preview.mockResolvedValueOnce({ ...payload, songs: complete.slice(0, 20) }).mockResolvedValueOnce({ ...payload, page: 2, songs: complete.slice(20) });
  mocks.import.mockResolvedValue({ name: payload.name, songs: complete });
  render(<PlaylistPreview {...props()} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '歌曲下一页' })); await settle();
  fireEvent.click(screen.getByLabelText('歌曲 21 - 歌手')); await settle();
  expect(mocks.play.mock.lastCall![0]).toHaveLength(21); expect(mocks.play.mock.lastCall![1].id).toBe('21');
  fireEvent.click(screen.getByRole('button', { name: '选择全部 21 首' })); await settle();
  expect(screen.getByText('已选 21 首')).toBeTruthy(); expect(mocks.import).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle(); expect(mocks.play.mock.lastCall![1].id).toBe('1');
});
it('can cancel a full playlist read and retry without a late request replacing the queue', async () => {
  const pending = deferred<typeof payload>(); mocks.import.mockReturnValueOnce(pending.promise);
  render(<PlaylistPreview {...props()} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle();
  expect(screen.getByText('正在读取完整歌单…')).toBeTruthy();
  expect((screen.getByRole('button', { name: '歌曲下一页' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消读取' }));
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle();
  expect(mocks.play).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(payload)); expect(mocks.play).toHaveBeenCalledOnce();
});
it('keeps selection after a full-read failure and marks authentication errors', async () => {
  const model = props(); render(<PlaylistPreview {...model} />); await settle();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择歌曲 音乐' }));
  mocks.import.mockRejectedValueOnce(new Error('完整歌单读取失败'));
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle();
  expect(screen.getByRole('alert').textContent).toBe('完整歌单读取失败'); expect(screen.getByText('已选 1 首')).toBeTruthy();
  mocks.import.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: '账号已失效' });
  fireEvent.click(screen.getByRole('button', { name: '选择全部 21 首' })); await settle();
  expect(model.markExpired).toHaveBeenCalledWith('qq'); expect(mocks.play).not.toHaveBeenCalled();
});
it('does not apply a complete response or playback error after closing the preview', async () => {
  const pending = deferred<typeof payload>(); mocks.import.mockReturnValueOnce(pending.promise);
  const view = render(<PlaylistPreview {...props()} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '选择全部 21 首' })); await settle(); view.unmount();
  await act(async () => pending.resolve(payload)); expect(mocks.play).not.toHaveBeenCalled();
  const playback = deferred<void>(); mocks.play.mockReturnValueOnce(playback.promise);
  const next = render(<PlaylistPreview {...props()} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle(); next.unmount();
  await act(async () => playback.reject(new Error('播放失败')));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('reports an empty full response, a removed start song and playback failure without changing imports', async () => {
  render(<PlaylistPreview {...props()} />); await settle();
  mocks.import.mockResolvedValueOnce({ name: 'preview', songs: [] });
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle();
  expect(screen.getByRole('alert').textContent).toContain('没有可读取');
  mocks.import.mockResolvedValueOnce({ ...payload, songs: [{ ...payload.songs[0], id: 'different' }] });
  fireEvent.click(screen.getByLabelText('音乐 - 歌手')); await settle(); expect(screen.getByRole('alert').textContent).toContain('已从歌单移除');
  mocks.play.mockRejectedValueOnce(new Error('音频播放失败'));
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle(); expect(screen.getByRole('alert').textContent).toBe('音频播放失败');
});
it('ignores a stale rejected full response and does not play from a busy preview', async () => {
  const pending = deferred<typeof payload>(); mocks.import.mockReturnValueOnce(pending.promise);
  const model = props(); const view = render(<PlaylistPreview {...model} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '播放全部' })); await settle();
  fireEvent.click(screen.getByLabelText('音乐 - 歌手')); expect(mocks.import).toHaveBeenCalledOnce();
  view.unmount(); await act(async () => pending.reject(new Error('迟到错误')));
  render(<PlaylistPreview {...model} busy />); await settle(); fireEvent.click(screen.getByLabelText('音乐 - 歌手')); expect(mocks.play).not.toHaveBeenCalled();
});
it('keeps pause and resume available inside the modal for platform playback', async () => {
  mocks.currentSong = { id: 'MID', source: 'qq', name: '音乐', artist: '歌手', album: '' }; mocks.playing = true;
  const model = props(); const view = render(<PlaylistPreview {...model} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '暂停播放' })); expect(mocks.togglePlay).toHaveBeenCalledOnce();
  mocks.playing = false; view.rerender(<PlaylistPreview {...model} />);
  fireEvent.click(screen.getByRole('button', { name: '继续播放' })); expect(mocks.togglePlay).toHaveBeenCalledTimes(2);
});
