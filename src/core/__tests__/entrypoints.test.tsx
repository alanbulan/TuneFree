import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
  invoke: vi.fn(),
  emit: vi.fn(),
  tauri: true,
}));
vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));
vi.mock('../../desktop/DesktopApp', () => ({ default: () => null }));
vi.mock('../../../app/desktop-lyric/page', () => ({ default: () => null }));
vi.mock('../ipc', () => ({
  isTauri: () => mocks.tauri,
  invokeCommand: mocks.invoke,
  emitEventTo: mocks.emit,
}));

let visibilityListener: EventListener | undefined;
let frames: FrameRequestCallback[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.tauri = true;
  mocks.createRoot.mockReturnValue({ render: mocks.render });
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.emit.mockReset().mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange') visibilityListener = listener as EventListener;
    originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
  visibilityListener = undefined;
  document.documentElement.classList.remove('app-hidden');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const paint = async () => {
  const callbacks = frames.splice(0);
  callbacks.forEach((callback) => callback(0));
  await Promise.resolve();
};

describe('window entrypoints', () => {
  it.each(['main', 'desktopLyricMain'] as const)('rejects %s without its mount point', async (entry) => {
    document.body.innerHTML = '';
    await expect(entry === 'main' ? import('../../main') : import('../../desktopLyricMain'))
      .rejects.toThrow('Missing root element');
    expect(mocks.createRoot).not.toHaveBeenCalled();
  });

  it('mounts the main window with error isolation and suspends hidden-window animations', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await import('../../main');
    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    const tree = mocks.render.mock.calls[0][0] as ReactElement<{ children: ReactElement }>;
    expect(tree.type).toBe(StrictMode);
    expect(tree.props.children.type).toBe((await import('../components/ErrorBoundary')).ErrorBoundary);
    expect(document.documentElement.classList.contains('app-hidden')).toBe(true);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('app-hidden')).toBe(false);
  });

  it('announces lyric readiness only after two animation frames', async () => {
    await import('../../desktopLyricMain');
    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    await paint();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await paint();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('mark_desktop_lyric_ready');
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith('main', 'desktop-lyric-ready', undefined);
  });

  it('reports failed lyric readiness without losing either notification', async () => {
    const error = new Error('window closed');
    mocks.invoke.mockRejectedValue(error);
    mocks.emit.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../../desktopLyricMain');
    await paint();
    await paint();
    expect(log).toHaveBeenCalledWith('Failed to mark desktop lyric ready:', error);
    expect(log).toHaveBeenCalledWith('Failed to announce desktop lyric readiness:', error);
  });

  it('mounts the browser lyric page without calling native IPC', async () => {
    mocks.tauri = false;
    await import('../../desktopLyricMain');
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
