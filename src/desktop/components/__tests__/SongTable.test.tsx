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
});
