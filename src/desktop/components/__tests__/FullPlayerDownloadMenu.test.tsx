import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../../core/types';
import FullPlayerDownloadMenu from '../fullplayer/FullPlayerDownloadMenu';

const mocks = vi.hoisted(() => ({ song: null as Song | null, download: vi.fn(), cancel: vi.fn() }));
vi.mock('../../../core/contexts/PlayerContext', () => ({
  usePlayerNowPlaying: () => ({ currentSong: mocks.song }),
  usePlayerSettings: () => ({ audioQuality: '320k' }),
}));
vi.mock('../../hooks/useSongDownload', async (original) => ({
  ...await original<typeof import('../../hooks/useSongDownload')>(),
  useSongDownload: () => ({ handleDownload: mocks.download, cancelDownload: mocks.cancel,
    isDownloading: false, isCancelling: false, downloadQuality: null, downloadProgress: null }),
}));

const song: Song = { id: '1', source: 'qq', name: '夜曲', artist: '歌手', album: '专辑' };
const trigger = () => screen.getByRole('button', { name: '下载' });
const item = (name: string) => screen.getByRole('menuitem', { name });
const key = (target: Element, value: string) => fireEvent.keyDown(target, { key: value });

beforeEach(() => { mocks.song = song; mocks.download.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('全屏播放器下载菜单', () => {
  it('方向键打开并在可用项间循环，Esc 只收起菜单并归还焦点', () => {
    const windowKeys = vi.fn(); window.addEventListener('keydown', windowKeys);
    render(<FullPlayerDownloadMenu />);
    trigger().focus(); key(trigger(), 'a'); expect(trigger().getAttribute('aria-expanded')).toBe('false');
    key(trigger(), 'ArrowDown');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('menu', { name: '下载音质' }).id);
    expect(document.activeElement).toBe(item('离线缓存'));
    key(document.activeElement!, 'ArrowDown'); expect(document.activeElement).toBe(item('128K'));
    key(document.activeElement!, 'ArrowUp'); key(document.activeElement!, 'ArrowUp'); expect(document.activeElement).toBe(item('Hi-Res'));
    key(document.activeElement!, 'Home'); expect(document.activeElement).toBe(item('离线缓存'));
    key(document.activeElement!, 'End'); expect(document.activeElement).toBe(item('Hi-Res'));
    windowKeys.mockClear(); key(document.activeElement!, 'Escape');
    expect(windowKeys).not.toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger());
    // 菜单已收起时 Esc 照常冒泡，交给全屏播放器关闭自身。
    key(trigger(), 'Escape'); expect(windowKeys).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', windowKeys);
  });

  it('点击菜单外、焦点移出或再次点按钮都会收起，离线缓存按当前音质下载', () => {
    const view = render(<><FullPlayerDownloadMenu /><button type="button">外部</button></>);
    const outside = screen.getByRole('button', { name: '外部' });
    fireEvent.click(trigger()); fireEvent.mouseDown(item('128K'));
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(outside); expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger()); fireEvent.blur(item('离线缓存'), { relatedTarget: item('128K') });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    fireEvent.blur(item('离线缓存'), { relatedTarget: outside }); expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger()); fireEvent.click(trigger()); expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger()); fireEvent.click(item('离线缓存'));
    expect(mocks.download).toHaveBeenCalledWith(song, '320k'); expect(document.activeElement).toBe(trigger());
    view.unmount();
  });

  it('全屏面板下方空间不足时向上展开，空间充足时向下展开', () => {
    const view = render(<div className="full-player-panel"><FullPlayerDownloadMenu /></div>);
    const panel = view.container.firstElementChild as HTMLElement;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600 } as DOMRect);
    const bounds = vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ top: 540, bottom: 574 } as DOMRect);
    fireEvent.click(trigger()); expect(screen.getByRole('menu').className).toContain('opens-upwards');
    fireEvent.click(trigger());
    bounds.mockReturnValue({ top: 100, bottom: 134 } as DOMRect);
    fireEvent.click(trigger());
    const menus = screen.getAllByRole('menu'); expect(menus[menus.length - 1].className).not.toContain('opens-upwards');
  });
});
