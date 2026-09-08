import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLyrics, type ParsedLyric } from '../../../src/core/utils/lyrics';
import { deferred } from '../../../src/core/__tests__/deferred';
import { THEME_STORAGE_KEYS } from '../../../src/core/utils/theme';
import { DesktopLyricStage } from '../_components/DesktopLyricStage';
import { useDesktopLyricBridge } from '../_core/useDesktopLyricBridge';
import { readAndApplyDesktopLyricTheme } from '../_core/theme';
import type { DesktopLyricPlayerState } from '../_core/types';
import DesktopLyricPage from '../page';

const mocks = vi.hoisted(() => ({ tauri: true, listen: vi.fn(), invoke: vi.fn(), resize: vi.fn(), dispose: vi.fn(), events: new Map<string, (v: unknown) => void>() }));
vi.mock('../../../src/core/ipc', () => ({ isTauri: () => mocks.tauri, listenEvent: mocks.listen, invokeCommand: mocks.invoke, getCurrentWindow: () => ({ startResizeDragging: mocks.resize }) }));
let height = 420, width = 650, contentHeight = 90;
const ready = async () => { await act(async () => {}); };
const emit = (name: string, value: unknown) => act(() => mocks.events.get(name)?.(value));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.tauri = true; height = 420; width = 650; contentHeight = 90; mocks.events.clear();
  mocks.invoke.mockReset().mockResolvedValue(undefined); mocks.resize.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockImplementation(async (name, handler) => { mocks.events.set(name, handler); return mocks.dispose; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const line: ParsedLyric = { time: 2, text: '歌词', words: [{ start: 2, duration: 1, text: '歌词' }],
  translation: '翻译', romanization: 'luo ma', pronunciation: '注音', extra: [{ type: 'translation', text: '第二翻译' }, { type: 'main', text: '附加' }] };
const state = (changes: Partial<DesktopLyricPlayerState> = {}): DesktopLyricPlayerState => ({ song: null,
  rows: [{ time: 0, text: '上一行' }, line, { time: 4, text: '下一行' }], activeIndex: 1,
  currentLine: line, currentTime: 2.5, lyricOffsetSeconds: 0, lyricDisplayMode: 'karaoke', isPlaying: true, ...changes });
const style = { size: 30, font: 'system-ui', lock: false };

describe('桌面歌词窗口', () => {
  it.each(['performance', 'date'])('使用 %s 时钟投射播放进度，暂停后释放动画帧', async (clock) => {
    let now = 10_000, frame: FrameRequestCallback = () => {};
    if (clock === 'performance') vi.spyOn(performance, 'now').mockImplementation(() => now);
    else { vi.stubGlobal('performance', undefined); vi.spyOn(Date, 'now').mockImplementation(() => now); }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 12; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const view = renderHook(useDesktopLyricBridge); await ready();
    emit('lyric-song', { trackKey: 'qq:1', id: '1', title: '歌曲', artist: '', source: 'qq', lrc: '[00:02]开始\n[00:06]继续' });
    emit('lyric-tick', { trackKey: 'qq:1', currentTime: 2, isPlaying: true, playbackRate: 2 });
    now += 2_000; act(() => frame(now));
    expect(view.result.current.playerState.currentTime).toBe(6);
    expect(view.result.current.playerState.currentLine?.text).toBe('继续');
    emit('lyric-tick', { trackKey: 'qq:1', currentTime: 6, isPlaying: false });
    expect(cancel).toHaveBeenCalledWith(12); view.unmount();
  });

  it('焦点、悬停显示工具栏，七个按钮与八个缩放方向连接原生接口', async () => {
    render(<DesktopLyricPage />); await ready(); const root = screen.getByRole('region');
    expect(screen.queryByTitle('上一首')).toBeNull(); fireEvent.mouseEnter(root);
    for (const title of ['上一首', '播放', '下一首', '字号放大', '字号缩小', '关闭桌面歌词']) fireEvent.click(screen.getByTitle(title));
    expect(mocks.invoke.mock.calls.map((call) => call[1].action)).toEqual(['prev', 'play-pause', 'next', 'adjust-lyric-size', 'adjust-lyric-size', 'close-lyric']);
    for (const handle of root.querySelectorAll('.desktop-lyric-resize-handle')) fireEvent.mouseDown(handle);
    expect(mocks.resize.mock.calls.map((call) => call[0])).toEqual(['North', 'South', 'West', 'East', 'NorthWest', 'NorthEast', 'SouthWest', 'SouthEast']);
    mocks.resize.mockRejectedValueOnce(new Error('resize')); vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.mouseDown(screen.getByTitle('向上调整歌词边界')); await ready(); expect(console.warn).toHaveBeenCalled();
    fireEvent.mouseLeave(root); expect(screen.queryByTitle('上一首')).toBeNull(); fireEvent.focus(root);
    fireEvent.blur(root, { relatedTarget: screen.getByTitle('上一首') }); expect(screen.getByTitle('上一首')).toBeTruthy();
    fireEvent.blur(root, { relatedTarget: document.body }); expect(screen.queryByTitle('上一首')).toBeNull();
    fireEvent.mouseEnter(root); emit('lyric-tick', { trackKey: '', currentTime: 0, isPlaying: true }); expect(screen.getByTitle('暂停')).toBeTruthy();
    fireEvent.click(screen.getByTitle('锁定歌词（锁定后鼠标可直接穿透）')); expect(screen.queryByTitle('上一首')).toBeNull(); expect(root.tabIndex).toBe(-1);
    emit('lock-change', false); expect(root.tabIndex).toBe(0);
  });

  it('上下文和扩展轨渲染完整，窄窗口自动缩字号，进度刷新保持逐字节点', () => {
    const player = state(); const view = render(<DesktopLyricStage player={player} styleState={style} />);
    expect(screen.getByText('上一行')).toBeTruthy(); expect(screen.getByText('下一行')).toBeTruthy(); expect(screen.getByText('luo ma')).toBeTruthy();
    const word = view.container.querySelector('.karaoke-word'); expect(word).toBeTruthy();
    view.rerender(<DesktopLyricStage player={{ ...player, currentTime: 2.8 }} styleState={style} />); expect(view.container.querySelector('.karaoke-word')).toBe(word);
    contentHeight = 240; height = 100; width = 300; fireEvent.resize(window);
    expect(view.container.querySelector('.desktop-lyric-stage-compact')).toBeTruthy();
    const primary = view.container.querySelector('.desktop-lyric-current-line > span') as HTMLElement;
    expect(primary.style.fontSize).toBe('12px');
    contentHeight = 40; height = 500; fireEvent.resize(window); expect(primary.style.fontSize).toBe('30px');
    document.documentElement.classList.add('dark-theme');
    view.rerender(<DesktopLyricStage player={state({ currentLine: { time: 7, text: '新行' }, rows: parseLyrics('[00:07]新行'), activeIndex: -1, lyricDisplayMode: 'line' })} styleState={{ ...style, size: 22 }} />);
    expect(screen.getByText('新行')).toBeTruthy();
    view.rerender(<DesktopLyricStage player={state({ currentLine: null, rows: [], activeIndex: -1 })} styleState={style} />);
    expect(screen.getByText('TuneFree Desktop')).toBeTruthy();
    view.rerender(<DesktopLyricStage player={state({ currentLine: null, rows: [], song: { id: '1', name: '器乐', artist: '乐团', source: 'qq' } })} styleState={style} />);
    expect(screen.getByText('器乐')).toBeTruthy(); expect(screen.getByText('乐团')).toBeTruthy();
  });

  it('命令失败不抛未处理异常，字体存储同步，异步订阅在卸载后释放', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderHook(useDesktopLyricBridge); await ready(); mocks.invoke.mockRejectedValueOnce(new Error('断开'));
    act(() => view.result.current.controls.playPause()); await ready(); expect(console.error).toHaveBeenCalled();
    localStorage.setItem(THEME_STORAGE_KEYS.lyricSize, '36'); fireEvent(window, new Event('storage')); expect(view.result.current.styleState.size).toBe(36);
    view.unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(4);
    const registration = deferred<() => void>(); mocks.listen.mockReturnValue(registration.promise);
    const next = renderHook(useDesktopLyricBridge); next.unmount(); await act(async () => registration.resolve(mocks.dispose)); expect(mocks.dispose).toHaveBeenCalledTimes(8);
    mocks.listen.mockRejectedValue(new Error('注册失败')); const failure = renderHook(useDesktopLyricBridge); await ready(); failure.unmount();
    expect(console.error).toHaveBeenCalledTimes(4);
  });

  it('无原生宿主时控件保持本地预览，主题读取在无窗口环境有默认值', async () => {
    mocks.tauri = false; const view = render(<DesktopLyricPage />); fireEvent.mouseEnter(screen.getByRole('region'));
    fireEvent.click(screen.getByTitle('播放')); fireEvent.mouseDown(screen.getByTitle('向上调整歌词边界'));
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.resize).not.toHaveBeenCalled(); view.unmount();
    vi.stubGlobal('window', undefined); expect(readAndApplyDesktopLyricTheme()).toEqual({ size: 22, font: 'system-ui', lock: false }); vi.unstubAllGlobals();
  });
});
