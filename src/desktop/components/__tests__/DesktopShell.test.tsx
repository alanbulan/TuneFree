import { useState, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../core/contexts/ThemeContext';
import { DesktopPreferencesProvider } from '../../../core/contexts/DesktopPreferencesContext';
import type { DesktopView } from '../../types';
import type { EventMap } from '../../../core/ipc';
import { deferred } from '../../../core/__tests__/deferred';
import DesktopShell from '../DesktopShell';

const mocks = vi.hoisted(() => ({
  tauri: true, toast: vi.fn(), invoke: vi.fn(), listen: vi.fn(), unsubscribe: vi.fn(),
  notice: null as null | { message: string; tone: string },
  close: null as null | ((event: { preventDefault: () => void }) => void),
  events: new Map<string, (payload: never) => void>(),
  window: { onCloseRequested: vi.fn(), hide: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
  toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
}));
vi.mock('../../../core/contexts/PlayerContext', () => ({ usePlayerNotice: () => ({ playerNotice: mocks.notice }),
  usePlayerActions: () => ({ togglePlay: mocks.toggle, playNext: mocks.next, playPrev: mocks.prev }) }));
vi.mock('../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../core/ipc')>(),
  isTauri: () => mocks.tauri, getCurrentWindow: () => mocks.window, invokeCommand: mocks.invoke,
  listenEvent: mocks.listen, emitEventTo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../features/home/DesktopHome', () => ({ default: ({ onViewChange, onAiBusyChange }: { onViewChange: (v: DesktopView) => void; onAiBusyChange: (v: boolean) => void }) =>
  <div>首页内容<button onClick={() => { onAiBusyChange(true); onViewChange('favorites'); }}>查看收藏</button></div> }));
vi.mock('../../features/search/DesktopSearch', () => ({ default: ({ commandQuery }: { commandQuery: string }) => <div>检索：{commandQuery}</div> }));
vi.mock('../../features/library/DesktopLibrary', () => ({ default: ({ activeView }: { activeView: string }) => <div>资料库：{activeView}</div> }));
vi.mock('../DesktopTransport', () => ({ default: ({ onExpand, suspended }: { onExpand: () => void; suspended: boolean }) => <button onClick={onExpand}>展开 {String(suspended)}</button> }));
vi.mock('../DesktopFullPlayer', () => ({ default: ({ onSearch, onClose }: { onSearch: (s: string) => void; onClose: () => void }) => <div><button onClick={() => onSearch('歌手')}>搜索歌手</button><button onClick={onClose}>收起</button></div> }));
vi.mock('../LyricSyncBridge', () => ({ default: () => null }));
vi.mock('../MiraPet', () => ({ default: ({ aiBusy }: { aiBusy: boolean }) => <span>伙伴：{String(aiBusy)}</span> }));

function Shell({ initial = 'home' }: { initial?: DesktopView }) {
  const [view, change] = useState(initial);
  return <DesktopShell view={view} onViewChange={change} />;
}
const Providers = ({ children }: PropsWithChildren) => <ThemeProvider><DesktopPreferencesProvider>{children}</DesktopPreferencesProvider></ThemeProvider>;
const ready = async () => { await act(async () => {}); };
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const closeRequest = async () => { await act(async () => mocks.close?.({ preventDefault: vi.fn() })); };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.tauri = true; mocks.notice = null; mocks.events.clear(); mocks.close = null;
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(mocks.window)) fn.mockReset().mockResolvedValue(undefined);
  mocks.window.onCloseRequested.mockImplementation(async (callback) => { mocks.close = callback; return mocks.unsubscribe; });
  mocks.listen.mockReset().mockImplementation(async (event, callback) => { mocks.events.set(event, callback); return mocks.unsubscribe; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('应用壳层导航与原生事件', () => {
  it('保留各页滚动、执行搜索请求、展开播放器并循环主题', async () => {
    mocks.notice = { message: '播放失败', tone: 'error' }; const view = render(<Shell />, { wrapper: Providers }); await ready();
    expect(mocks.toast).toHaveBeenCalledWith('播放失败', 'error');
    const scroll = view.container.querySelector('.view-scroll') as HTMLElement; scroll.scrollTop = 280; fireEvent.scroll(scroll);
    click('查看收藏'); await ready(); expect(scroll.scrollTop).toBe(0); expect(screen.getByText('伙伴：true')).toBeTruthy();
    click('首页'); expect(scroll.scrollTop).toBe(280); click('收起侧边菜单'); click('展开侧边菜单');
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /当前主题/ }));
    const input = screen.getByRole('textbox', { name: '搜索音乐' }); fireEvent.submit(input.closest('form')!);
    expect(screen.getByText('首页内容')).toBeTruthy();
    fireEvent.change(input, { target: { value: ' 夜曲 ' } }); fireEvent.submit(input.closest('form')!); await ready();
    expect(screen.getByText('检索：夜曲')).toBeTruthy(); expect(localStorage.getItem('tunefree_desktop_pending_query')).toBe('夜曲');
    click('展开 false'); click('搜索歌手'); await ready(); expect(screen.getByText('检索：歌手')).toBeTruthy(); click('收起');
    click('最小化'); click('最大化'); click('关闭'); await ready();
    expect(mocks.window.minimize).toHaveBeenCalled(); expect(mocks.window.toggleMaximize).toHaveBeenCalled(); expect(mocks.window.close).toHaveBeenCalled();
    mocks.window.close.mockRejectedValueOnce(new Error('关闭失败')); click('关闭'); await ready(); expect(console.error).toHaveBeenCalled();
  });

  it('关闭提示可取消、记住托盘选择，原生命令失败可见', async () => {
    render(<Shell />, { wrapper: Providers }); await ready(); await closeRequest();
    expect(screen.getByRole('dialog')).toBeTruthy(); await closeRequest(); click('取消');
    await closeRequest(); fireEvent.click(screen.getByRole('checkbox')); click('最小化到托盘'); await ready();
    expect(localStorage.getItem('tunefree_close_behavior')).toBe('tray'); expect(mocks.window.hide).toHaveBeenCalledTimes(1);
    await closeRequest(); expect(mocks.window.hide).toHaveBeenCalledTimes(2);
    mocks.window.hide.mockRejectedValueOnce(new Error('hide')); await closeRequest(); expect(mocks.toast).toHaveBeenLastCalledWith('最小化到托盘失败', 'error');
  });

  it('退出选择及预存的退出行为执行同一原生命令', async () => {
    const view = render(<Shell />, { wrapper: Providers }); await ready(); await closeRequest(); click('退出应用'); await ready();
    expect(mocks.invoke).toHaveBeenCalledWith('quit_app'); view.unmount();
    localStorage.setItem('tunefree_close_behavior', 'exit'); render(<Shell />, { wrapper: Providers }); await ready();
    mocks.invoke.mockRejectedValueOnce(new Error('quit')); await closeRequest(); expect(mocks.toast).toHaveBeenLastCalledWith('退出应用失败', 'error');
  });

  it('歌词六种控制保持最新字体和锁定状态，关闭通知同步设置', async () => {
    render(<Shell />, { wrapper: Providers }); await ready();
    const emit = (payload: EventMap['player-control']) => act(() => mocks.events.get('player-control')?.(payload as never));
    emit({ action: 'play-pause' }); emit({ action: 'next' }); emit({ action: 'prev' });
    expect(mocks.toggle).toHaveBeenCalled(); expect(mocks.next).toHaveBeenCalledWith(true); expect(mocks.prev).toHaveBeenCalled();
    emit({ action: 'toggle-lock' }); emit({ action: 'toggle-lock' }); expect(mocks.toast).toHaveBeenLastCalledWith('桌面歌词已解锁', 'success');
    emit({ action: 'toggle-lock', value: true }); emit({ action: 'adjust-lyric-size', value: 100 });
    expect(localStorage.getItem('tunefree_lyric_size')).toBe('36'); emit({ action: 'adjust-lyric-size', value: -100 });
    expect(localStorage.getItem('tunefree_lyric_size')).toBe('14'); emit({ action: 'close-lyric' });
    act(() => mocks.events.get('desktop-lyric-closed')?.(undefined as never));
  });

  it('异步订阅在卸载后完成会立即释放，注册失败记录错误', async () => {
    const registration = deferred<() => void>(); mocks.window.onCloseRequested.mockReturnValueOnce(registration.promise);
    const first = deferred<() => void>(); mocks.listen.mockReturnValueOnce(first.promise);
    const view = render(<Shell />, { wrapper: Providers }); view.unmount();
    await act(async () => { registration.resolve(mocks.unsubscribe); first.resolve(mocks.unsubscribe); });
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
    mocks.unsubscribe.mockClear(); const second = deferred<() => void>();
    mocks.listen.mockResolvedValueOnce(mocks.unsubscribe).mockReturnValueOnce(second.promise);
    const next = render(<Shell />, { wrapper: Providers }); await ready(); next.unmount();
    await act(async () => second.resolve(mocks.unsubscribe)); expect(mocks.unsubscribe).toHaveBeenCalledTimes(3);
    mocks.window.onCloseRequested.mockRejectedValueOnce(new Error('关闭订阅失败')); mocks.listen.mockRejectedValueOnce(new Error('歌词订阅失败'));
    render(<Shell />, { wrapper: Providers }); await ready(); expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('浏览器预览不注册原生监听', async () => {
    mocks.tauri = false; render(<Shell />, { wrapper: Providers }); await ready();
    expect(mocks.listen).not.toHaveBeenCalled(); expect(mocks.window.onCloseRequested).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
  });
});
