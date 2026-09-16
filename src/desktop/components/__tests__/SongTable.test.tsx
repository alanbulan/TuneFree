import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SongTable from '../SongTable';

afterEach(cleanup);
describe('歌曲表格的键盘和菜单', () => {
  it('整行和键盘可播放，行内操作不冒泡并使用最新回调', () => {
    const song = { id: '1', name: '夜曲', artist: '歌手', album: '', source: 'qq' };
    const play = vi.fn(), more = vi.fn(), favorite = vi.fn();
    const view = render(<SongTable songs={[song]} onPlay={play} onMore={more} onFavorite={favorite} />);
    const row = screen.getByLabelText('夜曲 - 歌手');
    fireEvent.click(row); fireEvent.keyDown(row, { key: 'Enter' }); fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'ArrowDown' }); expect(play).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: '更多操作 夜曲' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '收藏歌曲 夜曲' }), { key: 'Enter' });
    expect(play).toHaveBeenCalledTimes(3); expect(more).toHaveBeenCalledWith(song);
    const nextMore = vi.fn(); view.rerender(<SongTable songs={[song]} onPlay={play} onMore={nextMore} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作 夜曲' }));
    expect(nextMore).toHaveBeenCalledWith(song); expect(more).toHaveBeenCalledOnce();
  });

  it('行内操作按插槽开关渲染，删除按钮使用自定义文案', () => {
    const song = { id: '1', name: '夜曲', artist: '歌手', album: '', source: 'qq' };
    const onDelete = vi.fn(), onDismiss = vi.fn();
    render(<SongTable songs={[song]} onPlay={vi.fn()} onDelete={onDelete} deleteLabel="移出歌单"
      onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '移出歌单 夜曲' }));
    expect(onDelete).toHaveBeenCalledWith(song);
    fireEvent.click(screen.getByRole('button', { name: '不感兴趣 夜曲' }));
    expect(onDismiss).toHaveBeenCalledWith(song);
    // 没传 onFavorite / onMore 时不渲染对应按钮
    expect(screen.queryByRole('button', { name: /收藏歌曲/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /更多操作/ })).toBeNull();
  });
});

describe('拖拽排序', () => {
  const songs = [
    { id: '1', name: '甲', artist: 'a', album: '', source: 'qq' },
    { id: '2', name: '乙', artist: 'b', album: '', source: 'qq' },
    { id: '3', name: '丙', artist: 'c', album: '', source: 'qq' },
  ];
  const rows = () => songs.map((song) => screen.getByLabelText(`${song.name} - ${song.artist}`));

  it('拖动到目标行后在松手时提交一次重排', () => {
    const onReorder = vi.fn();
    render(<SongTable songs={songs} onPlay={vi.fn()} onReorder={onReorder} />);
    const [first, , third] = rows();
    expect(first.getAttribute('draggable')).toBe('true');

    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: '', dropEffect: '',
      setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key) ?? '',
    };
    fireEvent.dragStart(first, { dataTransfer });
    // 拖动中：源行与落点行各自带上状态类，但数据不动
    expect(first.className).toContain('is-dragging');
    fireEvent.dragOver(third, { dataTransfer });
    expect(third.className).toContain('is-drop-target');
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.drop(third, { dataTransfer });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 2);
    expect(first.className).not.toContain('is-dragging');
  });

  it('拖回原位、拖拽中断都不提交', () => {
    const onReorder = vi.fn();
    render(<SongTable songs={songs} onPlay={vi.fn()} onReorder={onReorder} />);
    const [first, second] = rows();
    const dataTransfer = {
      effectAllowed: '', dropEffect: '',
      setData: () => {}, getData: () => '0',
    };

    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragEnd(second);
    expect(onReorder).not.toHaveBeenCalled();
    expect(first.className).not.toContain('is-dragging');
  });

  it('Alt+方向键提供等价的键盘排序，普通方向键仍不触发', () => {
    const onReorder = vi.fn();
    render(<SongTable songs={songs} onPlay={vi.fn()} onReorder={onReorder} />);
    const [, second] = rows();

    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true });
    expect(onReorder).toHaveBeenCalledWith(1, 0);
    fireEvent.keyDown(second, { key: 'ArrowDown', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, 2);
  });

  it('未开启排序时行不可拖动，也没有拖拽回调', () => {
    render(<SongTable songs={songs} onPlay={vi.fn()} />);
    const first = rows()[0];
    expect(first.getAttribute('draggable')).toBe('false');
    fireEvent.dragStart(first);
    fireEvent.keyDown(first, { key: 'ArrowUp', altKey: true });
    expect(first.className).not.toContain('is-dragging');
  });
});
