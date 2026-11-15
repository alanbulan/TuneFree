import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAccount, PlatformPlaylistImport } from '../../../../../core/ipc';
import { deferred } from '../../../../../core/__tests__/deferred';
import AccountsView from '../../AccountsView';

const mocks = vi.hoisted(() => ({ native: true, list: vi.fn(), retryAccess: vi.fn(), start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), logout: vi.fn(), playlists: vi.fn(), preview: vi.fn(), listen: vi.fn(), play: vi.fn(), import: vi.fn(), create: vi.fn(), confirm: vi.fn(), toast: vi.fn(), local: [] as { name: string }[] }));
vi.mock('../../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../../core/ipc')>(), isTauri: () => mocks.native, listenEvent: mocks.listen }));
vi.mock('../../../../../core/services/platformAccounts', async (original) => ({ ...await original<typeof import('../../../../../core/services/platformAccounts')>(),
  platformAccounts: { list: mocks.list, retryAccess: mocks.retryAccess, start: mocks.start, finish: mocks.finish, cancel: mocks.cancel, refresh: mocks.refresh, logout: mocks.logout, playlists: mocks.playlists, import: mocks.import, preview: mocks.preview } }));
vi.mock('../../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play }), usePlayerNowPlaying: () => ({ currentSong: null, isPlaying: false }) }));
vi.mock('../../../../../core/contexts/LibraryContext', () => ({ useLibrary: () => ({ playlists: mocks.local, createPlaylist: mocks.create, isFavorite: () => false, toggleFavorite: vi.fn() }) }));
vi.mock('../../../../components/DialogHost', () => ({ useDesktopDialog: () => ({ confirmDialog: mocks.confirm }) }));
vi.mock('../../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
const account: PlatformAccount = { platform: 'netease', userId: '123', nickname: 'fixture', avatarUrl: 'https://p1.music.126.net/avatar.jpg', state: 'connected', connectedAt: 1 };
const payload: PlatformPlaylistImport = { name: '我的歌单', songs: [{ id: '1', source: 'netease', name: '歌', artist: '歌手', album: '专辑', pic: null, lyricId: null, strMediaMid: null }] };
const lists = [{ id: '42', name: '我的歌单', trackCount: 1, kind: 'created', coverUrl: 'https://p1.music.126.net/cover.jpg' },
  { id: '43', name: '收藏歌单', trackCount: 0, kind: 'collected', coverUrl: null }];
const settle = async () => { await act(async () => {}); };
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = true; mocks.local = [];
  mocks.list.mockReset().mockResolvedValue([account]); mocks.start.mockReset().mockResolvedValue({ platform: 'netease', attemptId: 'attempt', startedAt: 1 });
  mocks.retryAccess.mockReset().mockResolvedValue([account]);
  mocks.finish.mockReset().mockResolvedValue({ state: 'waiting', account: null }); mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.refresh.mockReset().mockResolvedValue(account); mocks.logout.mockReset().mockResolvedValue(undefined);
  mocks.playlists.mockReset().mockResolvedValue(lists); mocks.import.mockReset().mockResolvedValue(payload);
  mocks.create.mockReset().mockReturnValue(true); mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.listen.mockReset().mockResolvedValue(vi.fn());
  mocks.preview.mockReset().mockResolvedValue({ ...payload, total: 1, page: 1, pageSize: 20 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('desktop account page', () => {
  it('replaces a saved missing QQ portrait from a native profile update and recovers after an image error', async () => {
    const qq: PlatformAccount = { ...account, platform: 'qq', nickname: 'QQ fixture', avatarUrl: null, state: 'saved' };
    mocks.list.mockResolvedValue([qq]);
    let changed!: () => void;
    mocks.listen.mockImplementation(async (_event, listener) => { changed = listener; return vi.fn(); });
    render(<AccountsView />); await settle();
    const card = screen.getByRole('article', { name: 'QQ 音乐账号' });
    expect(card.querySelector('.account-avatar img')).toBeNull();
    const repaired = { ...qq, state: 'connected' as const, avatarUrl: 'https://thirdqq.qlogo.cn/g/current/100' };
    mocks.list.mockResolvedValueOnce([repaired]); await act(async () => changed());
    const image = card.querySelector<HTMLImageElement>('.account-avatar img')!;
    expect(image.getAttribute('src')).toBe(repaired.avatarUrl);
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image); await settle(); expect(card.querySelector('.account-avatar img')).toBeNull();
    mocks.refresh.mockResolvedValueOnce(repaired); click('检查连接'); await settle();
    expect(card.querySelector('.account-avatar img')?.getAttribute('src')).toBe(repaired.avatarUrl);
    const next = { ...repaired, avatarUrl: 'https://thirdqq.qlogo.cn/g/updated/100' };
    mocks.refresh.mockResolvedValueOnce(next); click('检查连接'); await settle();
    expect(card.querySelector('.account-avatar img')?.getAttribute('src')).toBe(next.avatarUrl);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('explains why a system credential read is still waiting', async () => {
    vi.useFakeTimers(); const pending = deferred<PlatformAccount[]>(); mocks.list.mockReturnValueOnce(pending.promise);
    render(<AccountsView />); await settle(); await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByText(/系统凭据存储正在等待响应/)).toBeTruthy();
    await act(async () => pending.resolve([account]));
    expect(screen.queryByText(/系统凭据存储正在等待响应/)).toBeNull();
  });
  it('opens the shared preview and imports after closing it', async () => {
    render(<AccountsView />); await settle();
    click('预览 我的歌单'); await settle();
    expect(screen.getByRole('dialog', { name: '我的歌单' })).toBeTruthy();
    click('关闭'); await settle(); expect(screen.queryByRole('dialog')).toBeNull();
    click('预览 我的歌单'); await settle(); click('导入这个歌单'); await settle();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('imports only the chosen preview songs after closing the modal and confirms a duplicate copy', async () => {
    mocks.local = [{ name: '我的歌单' }]; render(<AccountsView />); await settle();
    click('预览 我的歌单'); await settle(); fireEvent.click(screen.getByRole('checkbox', { name: '选择歌曲 歌' }));
    click('导入所选（1）'); await settle();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith('我的歌单', [{ id: '1', source: 'netease', name: '歌', artist: '歌手', album: '专辑' }]);
    expect(mocks.import).not.toHaveBeenCalled();
  });

  it('reloads a native account change without interfering with an in-progress login', async () => {
    let changed!: () => void; const unlisten = vi.fn();
    mocks.listen.mockImplementation(async (_event, listener) => { changed = listener; return unlisten; });
    const view = render(<AccountsView />); await settle();
    mocks.list.mockResolvedValueOnce([{ ...account, state: 'expired' }]);
    await act(async () => changed());
    expect(screen.getByText('需要重新登录')).toBeTruthy();
    const pending = deferred<{ platform: string; attemptId: string; startedAt: number }>();
    mocks.start.mockReturnValueOnce(pending.promise); click('重新登录'); await settle();
    await act(async () => changed());
    const calls = mocks.list.mock.calls.length;
    await act(async () => pending.resolve({ platform: 'netease', attemptId: 'latest', startedAt: 1 }));
    expect(screen.getByRole('region', { name: '网易云音乐登录引导' })).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(calls + 1);
    click('取消登录'); await settle();
    mocks.list.mockRejectedValueOnce(new Error('account snapshot failed')); await act(async () => changed());
    expect(screen.getByText('account snapshot failed')).toBeTruthy();
    view.unmount(); expect(unlisten).toHaveBeenCalledOnce();
  });

  it('unsubscribes even when the event listener attaches after leaving the page', async () => {
    const subscription = deferred<() => void>(); const unlisten = vi.fn(); mocks.listen.mockReturnValueOnce(subscription.promise);
    const view = render(<AccountsView />); await settle(); view.unmount();
    await act(async () => subscription.resolve(unlisten)); expect(unlisten).toHaveBeenCalledOnce();
  });
  it('imports a complete native playlist and confirms duplicate local copies', async () => {
    const view = render(<AccountsView />); await settle();
    expect(screen.getByText('fixture')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(mocks.create).toHaveBeenCalledWith('我的歌单', [{ id: '1', source: 'netease', name: '歌', artist: '歌手', album: '专辑' }]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('共 1 首'), 'success');
    mocks.local = [{ name: '我的歌单' }]; view.rerender(<AccountsView />);
    mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(mocks.import).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle(); expect(mocks.import).toHaveBeenCalledTimes(2);
    mocks.create.mockReturnValueOnce(false); fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('保存失败'), 'error');
  });

  it('reports import errors and marks expired sessions', async () => {
    render(<AccountsView />); await settle();
    mocks.import.mockRejectedValueOnce(new Error('incomplete batch'));
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(mocks.toast).toHaveBeenLastCalledWith('incomplete batch', 'error');
    click('重试失败（1）'); await settle(); expect(mocks.create).toHaveBeenCalledOnce();
    mocks.import.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: '已失效' });
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(screen.getByText('需要重新登录')).toBeTruthy(); expect(screen.getByRole('alert').textContent).toContain('连接已失效');
  });

  it('ignores import responses after switching platform or leaving the page', async () => {
    mocks.list.mockResolvedValue([account, { ...account, platform: 'qq', userId: '456', nickname: 'QQ fixture', avatarUrl: null }]);
    const view = render(<AccountsView />); await settle();
    const pending = deferred<PlatformPlaylistImport>(); mocks.import.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    click('查看哪个平台的歌单');
    fireEvent.click(screen.getByRole('option', { name: 'QQ 音乐' })); await settle();
    expect(screen.getByRole('heading', { name: 'QQ 音乐的歌单' })).toBeTruthy();
    expect(mocks.playlists).toHaveBeenLastCalledWith('qq');
    await act(async () => pending.resolve(payload)); expect(mocks.create).not.toHaveBeenCalled();
    const next = deferred<PlatformPlaylistImport>(); mocks.import.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle(); view.unmount();
    await act(async () => next.resolve(payload)); expect(mocks.create).not.toHaveBeenCalled();
  });

  it('can import from the newly selected account while an old import is pending', async () => {
    mocks.list.mockResolvedValue([account, { ...account, platform: 'qq', userId: '456' }]);
    render(<AccountsView />); await settle();
    const previous = deferred<PlatformPlaylistImport>(); mocks.import.mockReturnValueOnce(previous.promise);
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    click('查看哪个平台的歌单');
    fireEvent.click(screen.getByRole('option', { name: 'QQ 音乐' })); await settle();
    const current = deferred<PlatformPlaylistImport>(); mocks.import.mockReturnValueOnce(current.promise);
    fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); await settle();
    expect(mocks.import).toHaveBeenLastCalledWith('qq', '42');
    await act(async () => previous.resolve(payload));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '导入中…' })).toBeTruthy();
    await act(async () => current.resolve(payload));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '导入中…' })).toBeNull();
  });

  it('opens login guide, detects waiting and success and lets the user cancel', async () => {
    mocks.list.mockResolvedValue([]); render(<AccountsView />); await settle();
    expect(screen.getByText('你的音乐，在轻一点的地方')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '连接账号' })[0]); await settle();
    expect(screen.getByRole('region', { name: '网易云音乐登录引导' })).toBeTruthy();
    click('我已完成登录'); await settle(); expect(screen.getByRole('alert').textContent).toContain('尚未检测');
    click('取消登录'); await settle(); expect(mocks.cancel).toHaveBeenCalledWith('netease', 'attempt');
    fireEvent.click(screen.getAllByRole('button', { name: '连接账号' })[0]); await settle();
    mocks.finish.mockResolvedValueOnce({ state: 'connected', account }); click('我已完成登录'); await settle();
    expect(screen.getByText('已连接')).toBeTruthy();
    click('检查连接'); await settle(); expect(mocks.refresh).toHaveBeenCalledWith('netease');
    click('重新登录'); await settle(); click('取消登录'); await settle();
    mocks.confirm.mockResolvedValueOnce(false); click('退出登录'); await settle(); expect(mocks.logout).not.toHaveBeenCalled();
    click('退出登录'); await settle(); expect(mocks.logout).toHaveBeenCalledWith('netease');
  });

  it('shows browser limitations, loading, errors and retry controls', async () => {
    mocks.native = false; const first = render(<AccountsView />); await settle();
    expect(screen.getByRole('status').textContent).toContain('桌面应用');
    expect((screen.getAllByRole('button', { name: '连接账号' })[0] as HTMLButtonElement).disabled).toBe(true); first.unmount();
    mocks.native = true; mocks.list.mockRejectedValueOnce(new Error('vault failed')); render(<AccountsView />); await settle();
    expect(mocks.retryAccess).not.toHaveBeenCalled();
    click('重新读取账号'); await settle(); expect(screen.getByText('fixture')).toBeTruthy();
    expect(mocks.retryAccess).toHaveBeenCalledOnce(); expect(mocks.list).toHaveBeenCalledOnce();
    mocks.playlists.mockRejectedValueOnce(new Error('network failed')); click('刷新歌单'); await settle();
    expect(screen.getByRole('alert').textContent).toBe('network failed'); click('重新读取歌单'); await settle();
    mocks.playlists.mockResolvedValueOnce([]); click('刷新歌单'); await settle(); expect(screen.getByText('这个账号还没有可读取的歌单。')).toBeTruthy();
  });
});
