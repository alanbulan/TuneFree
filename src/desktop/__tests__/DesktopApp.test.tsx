import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../core/__tests__/deferred';
import DesktopApp from '../DesktopApp';

const mocks = vi.hoisted(() => ({ tauri: true, invoke: vi.fn(), info: vi.fn(), verify: vi.fn() }));
vi.mock('../../core/ipc', async (original) => ({ ...await original<typeof import('../../core/ipc')>(), isTauri: () => mocks.tauri, invokeCommand: mocks.invoke }));
vi.mock('../../core/services/config', () => ({ setLocalServerInfo: mocks.info }));
vi.mock('../../core/services/serverAllowlist', () => ({ verifyProxyAllowlist: mocks.verify }));
vi.mock('../../core/contexts/ThemeContext', () => ({ ThemeProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../../core/contexts/DesktopPreferencesContext', () => ({ DesktopPreferencesProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../../core/contexts/LibraryContext', () => ({ LibraryProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../../core/contexts/PlayerContext', () => ({ PlayerProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../components/DialogHost', () => ({ DialogProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../components/ToastHost', () => ({ ToastProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../hooks/useSongDownload', () => ({ DownloadProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('../components/RecommendationSyncBridge', () => ({ RecommendationSyncBridge: () => null }));
vi.mock('../components/LibrarySaveNotice', () => ({ LibrarySaveNotice: () => null }));
vi.mock('../components/DesktopShell', () => ({ default: ({ view, onViewChange }: { view: string; onViewChange: (v: string) => void }) =>
  <div><span>页面：{view}</span><button onClick={() => onViewChange('settings')}>设置</button></div> }));
const ready = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.useFakeTimers(); mocks.tauri = true; vi.clearAllMocks(); window.history.replaceState({}, '', '/');
  mocks.invoke.mockReset().mockResolvedValue({ port: 3200, token: 'session-test' }); mocks.verify.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('启动屏障和路由', () => {
  it('取得本地服务地址后才挂载业务页面，渲染就绪才通知后端', async () => {
    const pending = deferred<{ port: number; token: string }>(); mocks.invoke.mockReturnValueOnce(pending.promise);
    const view = render(<DesktopApp />); expect(screen.getByText('正在启动本地音乐服务…')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(150)); expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ port: 3200, token: 'session-test' }));
    expect(mocks.info).toHaveBeenCalledWith({ port: 3200, token: 'session-test' }); expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('.is-ready')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(32)); expect(mocks.invoke).toHaveBeenCalledWith('mark_frontend_ready');
    fireEvent.click(screen.getByRole('button', { name: '设置' })); expect(window.location.pathname).toBe('/library/settings');
    const push = vi.spyOn(window.history, 'pushState'); fireEvent.click(screen.getByRole('button', { name: '设置' })); expect(push).not.toHaveBeenCalled();
    for (const [path, name] of [['/', 'home'], ['/search', 'search'], ['/library', 'favorites'], ['/library/playlists', 'playlists'], ['/library/downloads', 'downloads'], ['/library/settings', 'settings'], ['/library/about', 'about']]) {
      window.history.replaceState({}, '', path); fireEvent.popState(window); expect(screen.getByText(`页面：${name}`)).toBeTruthy();
    }
    const menu = new MouseEvent('contextmenu', { cancelable: true }); document.dispatchEvent(menu); expect(menu.defaultPrevented).toBe(true);
    for (const options of [{ key: 'F5' }, { key: 'r', ctrlKey: true }, { key: 'R', ctrlKey: true }, { key: 'I', ctrlKey: true, shiftKey: true }, { key: 'i', ctrlKey: true, shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...options, cancelable: true }); document.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    }
    const plain = new KeyboardEvent('keydown', { key: 'r', cancelable: true }); document.dispatchEvent(plain); expect(plain.defaultPrevented).toBe(false);
  });

  it('服务启动失败显示错误，卸载后不接收迟到结果', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('端口不可用')); const view = render(<DesktopApp />); await ready();
    expect(screen.getByText(/本地音乐服务启动失败/)).toBeTruthy(); view.unmount();
    for (const fail of [false, true]) {
      const pending = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(pending.promise);
      const next = render(<DesktopApp />); next.unmount(); mocks.info.mockClear();
      await act(async () => { if (fail) pending.reject(new Error('晚到的失败')); else pending.resolve({ port: 2, token: 'late' }); });
      expect(mocks.info).not.toHaveBeenCalled();
    }
  });

  it('前端就绪通知失败有日志，浏览器模式跳过原生调用', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.invoke.mockImplementation(async (name) => { if (name === 'mark_frontend_ready') throw new Error('断开'); return { port: 3200, token: 'test' }; });
    const view = render(<DesktopApp />); await ready(); await act(async () => vi.advanceTimersByTimeAsync(160));
    await act(async () => vi.advanceTimersByTimeAsync(32));
    expect(console.error).toHaveBeenCalledWith('确认主界面启动就绪失败', expect.any(Error)); view.unmount();
    mocks.tauri = false; mocks.invoke.mockClear(); render(<DesktopApp initialView="downloads" />); await ready();
    expect(screen.getByText('页面：downloads')).toBeTruthy(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
