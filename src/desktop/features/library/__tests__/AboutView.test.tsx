import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../../core/ipc';
import { deferred } from '../../../../core/__tests__/deferred';
import { useUpdateChecker } from '../hooks/useUpdateChecker';
import AboutView from '../AboutView';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), version: vi.fn(), listen: vi.fn(), tauri: true,
  progress: null as null | ((payload: { progress: number }) => void), unlisten: vi.fn() }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(),
  isTauri: () => mocks.tauri, invokeCommand: mocks.invoke, getVersion: mocks.version, listenEvent: mocks.listen }));
vi.mock('../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
const ready = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.tauri = true; mocks.progress = null;
  mocks.version.mockReset().mockResolvedValue('1.2.3'); mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.listen.mockReset().mockImplementation((_event, callback) => { mocks.progress = callback; return Promise.resolve(mocks.unlisten); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('版本更新生命周期', () => {
  it('显示实际版本，手动检查无更新，重复检查不会重复请求', async () => {
    const { result } = renderHook(useUpdateChecker); await ready(); expect(result.current.appVersion).toBe('1.2.3');
    const check = deferred<null>(); mocks.invoke.mockReturnValueOnce(check.promise);
    let done!: Promise<void>;
    act(() => { done = result.current.handleCheckUpdate(); }); expect(result.current.checkingUpdate).toBe(true);
    await act(() => result.current.handleCheckUpdate()); expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { check.resolve(null); await done; });
    expect(mocks.toast).toHaveBeenCalledWith('当前已是最新版本 (v1.2.3)', 'info'); expect(result.current.checkingUpdate).toBe(false);
  });

  it('发现更新后使用签名安装命令并消费进度，成功事件清理下载状态', async () => {
    const install = deferred<void>();
    mocks.invoke.mockImplementation((command) => command === 'check_for_update' ? Promise.resolve({ version: '2.0.0' }) : install.promise);
    const { result } = renderHook(useUpdateChecker); await ready(); let done!: Promise<void>;
    act(() => { done = result.current.handleCheckUpdate(); }); await ready();
    expect(mocks.invoke).toHaveBeenCalledWith('download_and_install_update'); expect(result.current.downloadingUpdate).toBe(true);
    act(() => mocks.progress?.({ progress: 42 })); expect(result.current.updateDownloadProgress).toBe(42);
    await act(() => result.current.handleCheckUpdate()); expect(mocks.invoke).toHaveBeenCalledTimes(2);
    act(() => mocks.progress?.({ progress: 100 })); expect(result.current.downloadingUpdate).toBe(false); expect(result.current.updateDownloadProgress).toBeNull();
    await act(async () => { install.resolve(); await done; });
  });

  it('安装失败清理状态并打开官方页面，用户取消静默，原生打开失败走浏览器', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mocks.invoke.mockImplementation((command) => command === 'check_for_update' ? Promise.resolve({ version: '2' }) : Promise.reject(new IpcError('UPDATE_FAILED', '签名不匹配')));
    const { result } = renderHook(useUpdateChecker); await ready(); await act(() => result.current.handleCheckUpdate());
    expect(result.current.downloadingUpdate).toBe(false); expect(result.current.updateDownloadProgress).toBeNull();
    expect(mocks.toast).toHaveBeenLastCalledWith('签名不匹配，已为您打开官方发布页', 'error');
    expect(open).toHaveBeenCalledWith('https://github.com/alanbulan/TuneFree_Mobile/releases', '_blank', 'noopener,noreferrer');
    mocks.invoke.mockClear(); mocks.toast.mockClear(); open.mockClear();
    mocks.invoke.mockImplementation((command) => command === 'check_for_update' ? Promise.resolve({ version: '2' }) : Promise.reject(new IpcError('CANCELLED', 'cancel')));
    await act(() => result.current.handleCheckUpdate());
    expect(open).not.toHaveBeenCalled(); expect(mocks.toast.mock.calls.every((call) => call[1] === 'info')).toBe(true);
  });

  it('检查失败按错误码报告，版本读取失败仍能检查，订阅失败不产生未处理拒绝', async () => {
    mocks.version.mockRejectedValueOnce(new Error('version')); mocks.listen.mockRejectedValueOnce(new Error('events'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(useUpdateChecker); await ready(); expect(warning).toHaveBeenCalled();
    await act(() => result.current.handleCheckUpdate()); expect(mocks.toast).toHaveBeenLastCalledWith('当前已是最新版本', 'info');
    mocks.invoke.mockRejectedValueOnce(new IpcError('NETWORK', '断网')); await act(() => result.current.handleCheckUpdate());
    expect(mocks.toast).toHaveBeenLastCalledWith('断网，请检查网络后重试', 'warning');
    mocks.toast.mockClear(); mocks.invoke.mockRejectedValueOnce(new IpcError('CANCELLED', '取消'));
    await act(() => result.current.handleCheckUpdate()); expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('延迟的静默检查可发现更新，失败不打扰用户，卸载后释放迟到订阅', async () => {
    mocks.invoke.mockResolvedValueOnce({ version: '2.0' }).mockResolvedValue(undefined);
    const view = renderHook(useUpdateChecker); await ready(); await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.invoke).toHaveBeenCalledWith('download_and_install_update'); view.unmount(); expect(mocks.unlisten).toHaveBeenCalled();
    mocks.invoke.mockRejectedValue(new Error('offline')); mocks.toast.mockClear();
    const failed = renderHook(useUpdateChecker); await ready(); await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.toast).not.toHaveBeenCalled(); failed.unmount();
    const listener = deferred<() => void>(); mocks.listen.mockReturnValueOnce(listener.promise);
    const late = renderHook(useUpdateChecker); late.unmount();
    const dispose = vi.fn(); await act(async () => listener.resolve(dispose)); expect(dispose).toHaveBeenCalledOnce();
    act(() => mocks.progress?.({ progress: 50 }));
  });

  it('浏览器环境只打开发布页，不调用签名安装', async () => {
    mocks.tauri = false; const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mocks.invoke.mockRejectedValue(new Error('not native'));
    const { result } = renderHook(useUpdateChecker); await act(() => result.current.handleCheckUpdate());
    expect(mocks.listen).not.toHaveBeenCalled(); expect(mocks.version).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalledWith('download_and_install_update');
  });
});

describe('关于页', () => {
  it('技术栈由构建版本生成，外链和更新按钮连到真实视图逻辑', async () => {
    render(<AboutView />); await ready(); expect(screen.getByText('v1.2.3')).toBeTruthy();
    const versions = __TUNEFREE_BUILD_INFO__.tech;
    expect(screen.getByText(versions.react)).toBeTruthy(); expect(screen.getByText(versions.bloub)).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(`Tauri ${versions.tauri}`) })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /版本发布/ })); await ready();
    expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://github.com/alanbulan/TuneFree_Mobile/releases' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null); mocks.invoke.mockRejectedValueOnce(new Error('open'));
    fireEvent.click(screen.getByRole('link', { name: /bloub/ })); await ready(); expect(open).toHaveBeenCalledWith('https://github.com/jeremy-prt/bloub', '_blank', 'noopener,noreferrer');
    const check = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(check.promise);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' })); expect(screen.getByRole('button', { name: '正在检查…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => check.resolve(null)); expect(screen.getByRole('button', { name: '检查更新' })).toBeTruthy();
  });

  it('下载进度实时显示，浏览器回退展示构建应用版本', async () => {
    const install = deferred<void>(); mocks.invoke.mockImplementation((command) => command === 'check_for_update' ? Promise.resolve({ version: '2' }) : install.promise);
    const view = render(<AboutView />); await ready(); fireEvent.click(screen.getByRole('button', { name: '检查更新' })); await ready();
    expect(screen.getByRole('button', { name: '正在下载 0%' })).toBeTruthy();
    act(() => mocks.progress?.({ progress: 60 })); expect(screen.getByRole('button', { name: '正在下载 60%' })).toBeTruthy();
    await act(async () => { mocks.progress?.({ progress: 100 }); install.resolve(); }); view.unmount();
    mocks.tauri = false; render(<AboutView />); expect(screen.getByText(`v${__TUNEFREE_BUILD_INFO__.appVersion}`)).toBeTruthy();
    const open = vi.spyOn(window, 'open').mockReturnValue(null); fireEvent.click(screen.getByRole('link', { name: /Vite/ }));
    expect(open).toHaveBeenCalledWith('https://vite.dev/', '_blank', 'noopener,noreferrer');
  });
});
