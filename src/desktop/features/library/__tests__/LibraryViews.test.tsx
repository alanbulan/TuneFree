import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider } from '../../../../core/contexts/LibraryContext';
import { LIBRARY_KEY } from '../../../../core/contexts/libraryStorage';
import { IpcError } from '../../../../core/ipc';
import { importPlaylist } from '../../../../core/services/playlistImport';
import { deferred } from '../../../../core/__tests__/deferred';
import type { Song } from '../../../../core/types';
import type { OfflineDownloadMeta } from '../../../../core/services/offlineDownloads';
import FavoritesView from '../FavoritesView';
import DownloadsView from '../DownloadsView';
import DesktopLibrary from '../DesktopLibrary';

const mocks = vi.hoisted(() => ({ play: vi.fn(), toast: vi.fn(), prompt: vi.fn(), confirm: vi.fn(), list: vi.fn(),
  remove: vi.fn(), invoke: vi.fn(), tauri: true, changed: null as null | (() => void), unsubscribe: vi.fn() }));
vi.mock('../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play, playSong: mocks.play }),
  usePlayerNowPlaying: () => ({ currentSong: null, isPlaying: false }) }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(), isTauri: () => mocks.tauri, invokeCommand: mocks.invoke }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(), logRecommendationEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../core/services/playlistImport', async (original) => ({ ...await original<typeof import('../../../../core/services/playlistImport')>(), importPlaylist: vi.fn() }));
vi.mock('../../../../core/services/offlineDownloads', async (original) => ({ ...await original<typeof import('../../../../core/services/offlineDownloads')>(),
  listOfflineDownloads: mocks.list, deleteOfflineDownload: mocks.remove,
  subscribeOfflineDownloads: (callback: () => void) => { mocks.changed = callback; return mocks.unsubscribe; } }));
vi.mock('../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../../components/DialogHost', () => ({ useDesktopDialog: () => ({ confirmDialog: mocks.confirm, promptDialog: mocks.prompt }) }));

const song: Song = { id: '1', name: '夜曲', artist: '歌手', album: '', source: 'qq', pic: 'https://img.test/a.jpg' };
const ready = async () => { await act(async () => {}); };
const renderPlaylists = () => render(<DesktopLibrary activeView="playlists" />, { wrapper: LibraryProvider });
const setLibrary = () => localStorage.setItem(LIBRARY_KEY, JSON.stringify({ favorites: [song],
  playlists: [{ id: 'p1', name: '夜晚', createTime: 1, songs: [song] }, { id: 'p2', name: '', createTime: 2, songs: [] }] }));
const failWrites = () => {
  const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage),
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.tauri = true; mocks.changed = null;
  mocks.invoke.mockReset().mockResolvedValue('C:/Music'); mocks.list.mockReset().mockResolvedValue([]);
  mocks.remove.mockReset().mockResolvedValue(undefined); mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.prompt.mockReset().mockResolvedValue('新名字');
  vi.mocked(importPlaylist).mockReset().mockResolvedValue({ name: '导入歌单', songs: [song] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('歌单与收藏页面', () => {
  it('创建、打开、播放、收藏、移除歌曲和返回列表都更新真实曲库', async () => {
    setLibrary(); renderPlaylists();
    fireEvent.click(screen.getByRole('button', { name: '创建' })); expect(mocks.toast).not.toHaveBeenCalled();
    const name = screen.getByPlaceholderText('歌单名称'); fireEvent.change(name, { target: { value: ' 新歌单 ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect((name as HTMLInputElement).value).toBe(''); expect(screen.getByRole('button', { name: /新歌单.*打开/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /夜晚.*打开/ }));
    fireEvent.click(screen.getByRole('button', { name: '立即播放 夜曲' })); expect(mocks.play).toHaveBeenCalledWith([song], song);
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('已取消收藏', 'success', expect.anything());
    act(() => mocks.toast.mock.lastCall![2].onClick());
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' }));
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 夜曲' }));
    fireEvent.click(screen.getByRole('button', { name: '从歌单移除 夜曲' }));
    expect(screen.getByText('这个歌单还没有歌曲')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← 返回歌单列表' }));
    expect(screen.getByRole('button', { name: /夜晚.*0 首/ })).toBeTruthy();
  });

  it('重命名和删除经过确认，取消和同名不修改数据', async () => {
    setLibrary(); renderPlaylists(); fireEvent.click(screen.getByRole('button', { name: /夜晚.*打开/ }));
    mocks.prompt.mockResolvedValueOnce(null).mockResolvedValueOnce('夜晚');
    for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole('button', { name: '重命名' })); await ready(); }
    expect(mocks.toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重命名' })); await ready();
    expect(screen.getByRole('heading', { name: '新名字' })).toBeTruthy();
    mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getByRole('button', { name: '删除歌单' })); await ready();
    expect(screen.getByRole('heading', { name: '新名字' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除歌单' })); await ready();
    expect(screen.queryByRole('button', { name: /新名字.*打开/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /未命名歌单.*打开/ }));
    fireEvent.click(screen.getByRole('button', { name: '重命名' })); await ready();
    expect(mocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ message: '为「未命名歌单」输入新的名称。' }));
  });

  it('输入法合成不导入，导入中阻止重复提交，失败保留用户输入', async () => {
    renderPlaylists(); const input = screen.getByPlaceholderText('歌单链接或 ID');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(importPlaylist).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(importPlaylist).not.toHaveBeenCalled();
    const pending = deferred<{ name: string; songs: Song[] }>(); vi.mocked(importPlaylist).mockReturnValueOnce(pending.promise);
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(importPlaylist).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '导入中…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => pending.resolve({ name: '在线歌单', songs: [song] }));
    expect(screen.getByRole('button', { name: /在线歌单.*打开/ })).toBeTruthy(); expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: 'bad' } }); vi.mocked(importPlaylist).mockRejectedValueOnce(new Error('歌曲不可用'));
    fireEvent.click(screen.getByRole('button', { name: '导入' })); await ready();
    expect((input as HTMLInputElement).value).toBe('bad'); expect(mocks.toast.mock.lastCall![1]).toBe('error');
    fireEvent.click(screen.getByRole('button', { name: '网易云' })); fireEvent.click(screen.getByRole('option', { name: 'QQ音乐' }));
    fireEvent.click(screen.getByRole('button', { name: '导入' })); await ready(); expect(importPlaylist).toHaveBeenLastCalledWith('qq', 'bad');
  });

  it('写入失败时创建、导入、重命名、删除和收藏不报告成功', async () => {
    setLibrary(); renderPlaylists(); failWrites();
    fireEvent.change(screen.getByPlaceholderText('歌单名称'), { target: { value: '失败' } }); fireEvent.click(screen.getByRole('button', { name: '创建' }));
    fireEvent.change(screen.getByPlaceholderText('歌单链接或 ID'), { target: { value: '123' } }); fireEvent.click(screen.getByRole('button', { name: '导入' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: /夜晚.*打开/ }));
    fireEvent.click(screen.getByRole('button', { name: '重命名' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: '删除歌单' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' })); expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '夜晚' })).toBeTruthy();
  });

  it('收藏页播放和撤销可用，存储失败保留当前收藏', () => {
    setLibrary(); render(<FavoritesView />, { wrapper: LibraryProvider });
    fireEvent.click(screen.getByRole('button', { name: '立即播放 夜曲' })); expect(mocks.play).toHaveBeenCalledWith(song);
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' })); expect(screen.getByText('暂无收藏歌曲')).toBeTruthy();
    act(() => mocks.toast.mock.lastCall![2].onClick()); expect(screen.getByText('夜曲')).toBeTruthy();
    mocks.toast.mockClear(); failWrites(); fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' }));
    expect(mocks.toast).not.toHaveBeenCalled(); expect(screen.getByText('夜曲')).toBeTruthy();
  });
});

const download = (i: number): OfflineDownloadMeta => ({ filename: `${i}.mp3`, song: { ...song, id: String(i), name: `下载 ${i}`, source: i === 1 ? 'unknown' : 'qq' },
  quality: i === 1 ? 'flac24bit' : i === 2 ? 'flac' : '320k', createTime: 1000, size: 1024 * i });

describe('下载页面', () => {
  it('分页、播放和删除后收敛页码，目录以后端读取结果为准', async () => {
    const items = Array.from({ length: 11 }, (_, i) => download(i)); mocks.list.mockResolvedValue(items);
    render(<DownloadsView />); await ready();
    expect(screen.getByText('C:/Music')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '打开文件夹' })); await ready();
    expect(mocks.invoke).toHaveBeenCalledWith('open_download_dir');
    fireEvent.click(screen.getAllByRole('button', { name: '播放' })[0]); expect(mocks.play).toHaveBeenCalledWith(items[0].song);
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); expect(screen.getByText('第 2 / 2 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一页' })); expect(screen.getByText('第 1 / 2 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); fireEvent.click(screen.getByRole('button', { name: '删除' })); await ready();
    expect(mocks.remove).toHaveBeenCalledWith('10.mp3'); expect(mocks.toast).toHaveBeenLastCalledWith('已删除本地文件', 'success');
    mocks.list.mockResolvedValueOnce(items.slice(0, 10)); await act(async () => mocks.changed?.());
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull(); expect(screen.getByText('下载 0')).toBeTruthy();
  });

  it('目录失效提供重新选择，取消静默，选目录失败不重复嵌套弹窗', async () => {
    mocks.list.mockResolvedValue([download(0)]); render(<DownloadsView />); await ready();
    mocks.invoke.mockRejectedValueOnce(new IpcError('DOWNLOAD_DIR_INVALID', '目录失效'));
    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' })); await ready();
    const select = mocks.toast.mock.lastCall![2].onClick;
    mocks.invoke.mockResolvedValueOnce(null); await act(async () => select()); expect(screen.getByText('C:/Music')).toBeTruthy();
    mocks.invoke.mockResolvedValueOnce('D:/New'); await act(async () => select()); expect(screen.getByText('D:/New')).toBeTruthy();
    mocks.invoke.mockRejectedValueOnce(new IpcError('IO', '选择失败')); await act(async () => select());
    expect(mocks.toast).toHaveBeenLastCalledWith('选择失败', 'error');
    mocks.remove.mockRejectedValueOnce(new IpcError('CANCELLED', '取消')); mocks.toast.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '删除' })); await ready(); expect(mocks.toast).not.toHaveBeenCalled();
    mocks.remove.mockRejectedValueOnce(new IpcError('IO', '文件占用'));
    fireEvent.click(screen.getByRole('button', { name: '删除' })); await ready(); expect(mocks.toast).toHaveBeenLastCalledWith('文件占用', 'error', undefined);
  });

  it('扫描失败显示错误，卸载后迟到结果或事件不改变页面', async () => {
    mocks.tauri = false; mocks.list.mockRejectedValueOnce(new IpcError('IO', '扫描失败'));
    const view = render(<DownloadsView />); await ready();
    expect(screen.getByText('暂无离线条目')).toBeTruthy(); expect(mocks.toast).toHaveBeenLastCalledWith('扫描失败', 'error');
    view.unmount(); expect(mocks.unsubscribe).toHaveBeenCalled();
    mocks.tauri = true; const pending = deferred<OfflineDownloadMeta[]>(); const directory = deferred<string>();
    mocks.list.mockReturnValueOnce(pending.promise); mocks.invoke.mockReturnValueOnce(directory.promise);
    const next = render(<DownloadsView />); next.unmount();
    await act(async () => { pending.resolve([download(1)]); directory.resolve('late'); });
    const rejected = deferred<OfflineDownloadMeta[]>(); mocks.list.mockReturnValueOnce(rejected.promise);
    mocks.invoke.mockRejectedValueOnce(new Error('dir')); const last = render(<DownloadsView />); last.unmount();
    mocks.toast.mockClear(); await act(async () => rejected.reject(new Error('late'))); expect(mocks.toast).not.toHaveBeenCalled();
  });
});
