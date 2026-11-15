import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import AccountPlaylists from '../AccountPlaylists';

afterEach(cleanup);
const account = { platform: 'netease' as const, userId: '1', nickname: 'fixture', avatarUrl: null, state: 'connected' as const, connectedAt: 1 };
function props(): ComponentProps<typeof AccountPlaylists> {
  return { accounts: [account], account, loading: false, error: '', busy: false, statuses: {}, progress: { completed: 0, total: 0, running: false },
    playlists: Array.from({ length: 23 }, (_, index) => ({ id: String(index), name: `歌单 ${index}`, coverUrl: null, trackCount: index, kind: 'created' })),
    onSelect: vi.fn(), onReload: vi.fn(), onImport: vi.fn(), onPreview: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn() };
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
it('renders ten playlists per page and retains selection across pages for a single batch', () => {
  const model = props(); const view = render(<AccountPlaylists {...model} />);
  expect(screen.getAllByRole('button', { name: /^预览 / })).toHaveLength(10);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择本页歌单' }));
  expect(screen.getByText('已选 10 个')).toBeTruthy();
  click('歌单下一页'); fireEvent.click(screen.getByRole('checkbox', { name: '选择 歌单 10' }));
  expect(screen.getByText('已选 11 个')).toBeTruthy();
  click('批量导入（11）'); expect(model.onImport).toHaveBeenCalledWith(model.playlists.slice(0, 11));
  click('歌单下一页'); expect(screen.getAllByRole('button', { name: /^预览 / })).toHaveLength(3);
  click('选择全部 23 个'); expect(screen.getByText('已选 23 个')).toBeTruthy();
  click('歌单上一页'); fireEvent.click(screen.getByRole('checkbox', { name: '选择本页歌单' }));
  expect(screen.getByText('已选 13 个')).toBeTruthy();
  click('清空选择'); expect(screen.getByText('已选 0 个')).toBeTruthy();
  click('预览 歌单 10'); expect(model.onPreview).toHaveBeenCalledWith(model.playlists[10]);
  view.rerender(<AccountPlaylists {...model} playlists={model.playlists.slice(0, 2)} />);
  expect(screen.getByText('第 1 / 1 页')).toBeTruthy();
});
it('shows batch states, stopping and retry without disabling platform selection', () => {
  const model = props(); model.accounts.push({ ...account, platform: 'qq' as 'netease' });
  model.progress = { total: 23, completed: 3, running: true }; model.busy = true;
  model.statuses = { '0': { playlist: model.playlists[0], state: 'importing', message: '导入中…' } };
  const view = render(<AccountPlaylists {...model} />);
  click('停止导入'); expect(model.onCancel).toHaveBeenCalledOnce();
  click('查看哪个平台的歌单'); fireEvent.click(screen.getByRole('option', { name: 'QQ 音乐' }));
  expect(model.onSelect).toHaveBeenCalledWith('qq');
  model.progress.running = false; model.busy = false;
  model.statuses['0'] = { playlist: model.playlists[0], state: 'failed', message: '请求失败' };
  view.rerender(<AccountPlaylists {...model} />); click('重试失败（1）'); expect(model.onRetry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getAllByRole('button', { name: '导入到本地' })[0]); expect(model.onImport).toHaveBeenCalledWith([model.playlists[0]]);
});
