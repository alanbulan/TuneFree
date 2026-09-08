import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider, useDesktopDialog } from '../DialogHost';
import { ToastProvider, useToast } from '../ToastHost';
import ClosePrompt from '../ClosePrompt';
import { LibrarySaveNotice } from '../LibrarySaveNotice';
import { LibraryProvider, useLibraryActions } from '../../../core/contexts/LibraryContext';

const tick = async (ms = 300) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('桌面弹窗与提示', () => {
  it('确认、输入、取消、遮罩与 Escape 按约定返回结果，焦点进入输入框', async () => {
    const { result } = renderHook(useDesktopDialog, { wrapper: DialogProvider });
    let response!: Promise<boolean | string | null>;
    act(() => { response = result.current.confirmDialog({ title: '删除', message: '确定删除？', tone: 'danger' }); });
    await tick(); expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    fireEvent.mouseDown(screen.getByRole('dialog')); expect(screen.getByText('确定删除？')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.submit(screen.getByRole('dialog'));
    await expect(response).resolves.toBe(true); await tick();
    act(() => { response = result.current.promptDialog({ title: '命名', defaultValue: '旧名称', placeholder: '新名称' }); });
    await tick(); expect(document.activeElement).toBe(screen.getByPlaceholderText('新名称'));
    fireEvent.change(screen.getByPlaceholderText('新名称'), { target: { value: '新的名称' } }); fireEvent.submit(screen.getByRole('dialog'));
    await expect(response).resolves.toBe('新的名称'); await tick();
    act(() => { response = result.current.promptDialog({ title: '取消输入' }); });
    fireEvent.click(screen.getByRole('button', { name: '取消' })); await expect(response).resolves.toBeNull(); await tick();
    act(() => { response = result.current.confirmDialog({ title: '关闭确认' }); });
    fireEvent.keyDown(window, { key: 'Escape' }); await expect(response).resolves.toBe(false); await tick();
    act(() => { response = result.current.promptDialog({ title: '点遮罩' }); });
    fireEvent.mouseDown(screen.getByRole('presentation')); await expect(response).resolves.toBeNull(); await tick();
  });

  it('关闭提示约束 Tab 焦点、记住选择并返回三种关闭动作', async () => {
    const resolve = vi.fn(), remember = vi.fn();
    const view = render(<ClosePrompt open={false} rememberChoice={false} onRememberChoiceChange={remember} onResolve={resolve} />);
    view.rerender(<ClosePrompt open rememberChoice={false} onRememberChoiceChange={remember} onResolve={resolve} />);
    await tick(60); expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    const first = screen.getByRole('checkbox'), last = screen.getByRole('button', { name: '退出应用' });
    last.focus(); fireEvent.keyDown(window, { key: 'Tab' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.click(first); expect(remember).toHaveBeenCalledWith(true);
    fireEvent.mouseDown(screen.getByRole('dialog')); expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' })); fireEvent.click(screen.getByRole('button', { name: '最小化到托盘' })); fireEvent.click(last);
    fireEvent.mouseDown(screen.getByRole('presentation')); expect(resolve.mock.calls).toEqual([['cancel'], ['tray'], ['exit'], ['cancel']]);
  });

  it('提示替换会重置计时，撤销与主动关闭取消超时，卸载释放定时器', async () => {
    const action = vi.fn(); const view = renderHook(useToast, { wrapper: ToastProvider });
    act(() => view.result.current.showToast('第一条')); await tick(1000);
    act(() => view.result.current.showToast('第二条', 'success', { label: '撤销', onClick: action }));
    await tick(3200); expect(screen.getByRole('status').textContent).toContain('第二条');
    fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(action).toHaveBeenCalledTimes(1); expect(screen.queryByRole('status')).toBeNull();
    act(() => view.result.current.showToast('自动关闭')); await tick(3201); expect(screen.queryByRole('status')).toBeNull();
    act(() => view.result.current.showToast('手动关闭')); fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('status')).toBeNull(); act(() => view.result.current.showToast('卸载')); view.unmount();
    await tick(6000); expect(screen.queryByRole('status')).toBeNull();
  });

  it('曲库写入失败展示可读提示，缺少 Provider 的调用明确报错', () => {
    const Probe = () => { const { createPlaylist } = useLibraryActions(); return <button onClick={() => createPlaylist('列表')}>保存</button>; };
    render(<LibraryProvider><ToastProvider><LibrarySaveNotice /><Probe /></ToastProvider></LibraryProvider>);
    const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {}); fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('status').textContent).toContain('曲库保存失败');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useToast)).toThrow('ToastProvider'); expect(() => renderHook(useDesktopDialog)).toThrow('DialogProvider');
  });
});
