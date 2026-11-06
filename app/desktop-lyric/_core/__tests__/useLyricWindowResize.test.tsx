import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../../src/core/__tests__/deferred';
import { DesktopLyricResizeHandles } from '../../_components/DesktopLyricResizeHandles';

const mocks = vi.hoisted(() => ({
  tauri: true, os: 'macos', invoke: vi.fn(), size: vi.fn(), position: vi.fn(),
  native: vi.fn(), capture: vi.fn(), release: vi.fn(),
}));
vi.mock('../../../../src/core/ipc', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  isTauri: () => mocks.tauri,
  invokeCommand: mocks.invoke,
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: 200, y: 100 }),
    outerSize: async () => ({ width: 1800, height: 600 }),
    scaleFactor: async () => 2,
    setSize: mocks.size, setPosition: mocks.position, startResizeDragging: mocks.native,
  }),
}));
const ready = async () => { await act(async () => {}); };
const edge = (name = '向下调整歌词边界') => screen.getByLabelText(name);
const down = (button: HTMLElement, extra = {}) => fireEvent.pointerDown(button, { button: 0, pointerId: 1, screenX: 100, screenY: 100, ...extra });
const move = (button: HTMLElement, screenX: number, screenY: number, pointerId = 1) => fireEvent.pointerMove(button, { pointerId, screenX, screenY });
const up = (button: HTMLElement) => fireEvent.pointerUp(button, { pointerId: 1, screenX: 150, screenY: 200 });

beforeEach(() => {
  mocks.tauri = true; mocks.os = 'macos';
  for (const mock of [mocks.invoke, mocks.size, mocks.position, mocks.native]) mock.mockReset().mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async () => ({ os: mocks.os }));
  mocks.capture.mockClear(); mocks.release.mockClear();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: mocks.capture },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: mocks.release },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  for (const method of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) Reflect.deleteProperty(HTMLElement.prototype, method);
});

describe('macOS lyric resize lifecycle', () => {
  it('resizes vertically with Retina coordinates and flushes the final pointer position', async () => {
    const view = render(<DesktopLyricResizeHandles />);
    down(edge()); await ready();
    expect(view.container.querySelector('[data-resizing]')?.getAttribute('data-resizing')).toBe('true');
    move(edge(), 150, 180); await ready();
    expect(mocks.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1800, height: 760 }));
    up(edge()); await ready();
    expect(mocks.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1800, height: 800 }));
    expect(mocks.position).not.toHaveBeenCalled();
    expect(mocks.native).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(1);
    expect(view.container.querySelector('[data-resizing]')?.getAttribute('data-resizing')).toBe('false');
  });

  it('coalesces backlogged native writes and preserves the opposite north-west corner', async () => {
    render(<DesktopLyricResizeHandles />);
    const button = edge('调整左上角歌词边界');
    down(button); await ready();
    const pending = deferred<void>(); mocks.size.mockReturnValueOnce(pending.promise);
    move(button, 120, 120); move(button, 140, 140); move(button, 150, 150);
    expect(mocks.size).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(mocks.size).toHaveBeenCalledTimes(2);
    expect(mocks.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1700, height: 500 }));
    expect(mocks.position).toHaveBeenLastCalledWith(expect.objectContaining({ x: 300, y: 200 }));
    move(button, 900, 900, 2); await ready(); expect(mocks.size).toHaveBeenCalledTimes(2);
    fireEvent.pointerCancel(button, { pointerId: 1 });
    move(button, 200, 200); await ready(); expect(mocks.size).toHaveBeenCalledTimes(2);
  });

  it('applies a quick drag even when pointerup arrives before runtime information', async () => {
    const pending = deferred<{ os: string }>(); mocks.invoke.mockReturnValueOnce(pending.promise);
    const view = render(<DesktopLyricResizeHandles />);
    down(edge()); move(edge(), 130, 170); up(edge());
    fireEvent.lostPointerCapture(edge(), { pointerId: 1 });
    expect(mocks.size).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ os: 'macos' }));
    expect(mocks.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1800, height: 800 }));
    expect(view.container.querySelector('[data-resizing]')?.getAttribute('data-resizing')).toBe('false');
  });

  it.each(['disabled', 'unmount', 'cancel'] as const)('cancels startup on %s before native initialization completes', async (reason) => {
    const pending = deferred<{ os: string }>(); mocks.invoke.mockReturnValueOnce(pending.promise);
    const view = render(<DesktopLyricResizeHandles />); down(edge());
    if (reason === 'disabled') view.rerender(<DesktopLyricResizeHandles disabled />);
    else if (reason === 'unmount') view.unmount();
    else fireEvent.pointerCancel(edge(), { pointerId: 1 });
    await act(async () => pending.resolve({ os: 'macos' }));
    expect(mocks.size).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
  });

  it('cancels pending work on lost capture and locking, including in-flight native writes', async () => {
    const view = render(<DesktopLyricResizeHandles />);
    const button = edge('向上调整歌词边界'); down(button); await ready();
    const pending = deferred<void>(); mocks.size.mockReturnValueOnce(pending.promise);
    move(button, 120, 120); move(button, 150, 150);
    view.rerender(<DesktopLyricResizeHandles disabled />);
    await act(async () => pending.resolve());
    expect(mocks.size).toHaveBeenCalledTimes(1); expect(mocks.position).not.toHaveBeenCalled();
    view.rerender(<DesktopLyricResizeHandles />); down(edge()); await ready();
    fireEvent.lostPointerCapture(edge(), { pointerId: 1 });
    move(edge(), 120, 200); expect(mocks.size).toHaveBeenCalledTimes(1);
  });

  it('uses the supported native resize on other platforms and ignores preview/right click', async () => {
    mocks.os = 'windows'; render(<DesktopLyricResizeHandles />);
    down(edge(), { button: 2 }); expect(mocks.capture).not.toHaveBeenCalled();
    down(edge()); await ready(); expect(mocks.native).toHaveBeenCalledWith('South');
    up(edge()); mocks.tauri = false; down(edge());
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it('reports failed startup and native resize without leaving unhandled promises', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<DesktopLyricResizeHandles />);
    mocks.invoke.mockRejectedValueOnce(new Error('window closed')); down(edge()); await ready();
    expect(log).toHaveBeenCalledWith('Failed to start desktop lyric resize:', expect.any(Error));
    down(edge()); await ready();
    mocks.size.mockRejectedValueOnce(new Error('resize failed')); move(edge(), 150, 200); await ready();
    expect(log).toHaveBeenCalledWith('Failed to resize desktop lyrics:', expect.any(Error));
  });
});
