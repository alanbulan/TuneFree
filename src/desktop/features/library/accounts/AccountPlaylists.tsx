import { useState } from 'react';
import { Download, ListMusic, RefreshCw } from 'lucide-react';
import type { AccountPlatform, PlatformAccount, PlatformPlaylist } from '../../../../core/ipc';
import { accountPlatformName } from '../../../../core/services/platformAccounts';
import CustomSelect from '../components/CustomSelect';
import LibraryPagination from '../components/LibraryPagination';
import type { PlaylistImportStatus } from './usePlaylistImports';

interface Props {
  accounts: PlatformAccount[];
  account: PlatformAccount;
  loading: boolean;
  error: string;
  playlists: PlatformPlaylist[];
  busy: boolean;
  statuses: Record<string, PlaylistImportStatus>;
  progress: { completed: number; total: number; running: boolean };
  onSelect: (platform: AccountPlatform) => void;
  onReload: () => void;
  onImport: (playlists: PlatformPlaylist[]) => void;
  onPreview: (playlist: PlatformPlaylist) => void;
  onCancel: () => void;
  onRetry: () => void;
}

const PAGE_SIZE = 10;
export function EmptyAccounts() {
  return <div className="accounts-empty"><ListMusic size={38} aria-hidden="true" /><h2>你的音乐，在轻一点的地方</h2>
    <p>连接音乐账号，直接听歌，也能预览和导入个人歌单。</p><span>网易云 · QQ · 酷我，可同时连接</span></div>;
}

export default function AccountPlaylists({ accounts, account, loading, error, playlists, busy, statuses, progress,
  onSelect, onReload, onImport, onPreview, onCancel, onRetry }: Props) {
  const [requestedPage, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(playlists.length / PAGE_SIZE)));
  const visible = playlists.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const chosen = playlists.filter((item) => selected.has(item.id));
  const pageSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));
  const failed = Object.values(statuses).filter((item) => item.state === 'failed').length;
  const toggle = (ids: string[], checked: boolean) => setSelected((previous) => {
    const next = new Set(previous); ids.forEach((id) => checked ? next.add(id) : next.delete(id)); return next;
  });
  return <section className="account-playlists" aria-label="平台歌单">
    <div className="account-playlist-heading">
      <div><h2>{accountPlatformName(account.platform)}的歌单</h2><p>打开歌单即可播放，也可以多选后保存到本地。</p></div>
      <div className="account-playlist-tools">
        {accounts.length > 1 && <div className="account-platform-picker"><CustomSelect size="compact"
          ariaLabel="查看哪个平台的歌单" value={account.platform}
          options={accounts.map((item) => ({ value: item.platform, label: accountPlatformName(item.platform) }))}
          onChange={(value) => onSelect(value as AccountPlatform)} /></div>}
        <button type="button" className="soft-button" disabled={loading || busy || account.state === 'expired'} onClick={onReload}>
          <RefreshCw size={14} className={loading ? 'account-spinner' : ''} aria-hidden="true" /> {loading ? '读取歌单中…' : '刷新歌单'}</button>
      </div>
    </div>
    {account.state === 'expired' ? <p className="account-error" role="alert">连接已失效，请重新登录后读取歌单。已导入的本地歌单仍可使用。</p>
      : error ? <div className="account-playlist-error"><p className="account-error" role="alert">{error}</p><button type="button" className="soft-button" onClick={onReload}>重新读取歌单</button></div>
        : loading ? <p className="account-loading" role="status">正在读取创建和收藏的歌单…</p>
          : playlists.length === 0 ? <p className="account-loading">这个账号还没有可读取的歌单。</p> : <>
            <div className="account-selection-bar">
              <label className="account-selection"><input className="settings-checkbox is-small" type="checkbox" aria-label="选择本页歌单"
                checked={pageSelected} disabled={busy} onChange={(event) => toggle(visible.map((item) => item.id), event.target.checked)} />本页全选</label>
              <button type="button" className="account-text-button" disabled={busy || chosen.length === playlists.length} onClick={() => toggle(playlists.map((item) => item.id), true)}>选择全部 {playlists.length} 个</button>
              <span className="account-selection-count" role="status">已选 {chosen.length} 个</span>
              {chosen.length > 0 && <button type="button" className="account-text-button" disabled={busy} onClick={() => setSelected(new Set())}>清空选择</button>}
              <button type="button" className="primary-button account-batch-button" disabled={busy || chosen.length === 0} onClick={() => onImport(chosen)}>
                <Download size={14} aria-hidden="true" />批量导入{chosen.length ? `（${chosen.length}）` : ''}</button>
            </div>
            {progress.total > 0 && <div className="account-import-progress" aria-live="polite">
              <span>{progress.running ? '正在导入' : '已处理'} {progress.completed} / {progress.total} 个歌单{failed > 0 ? ` · ${failed} 个失败` : ''}</span>
              {progress.running ? <button type="button" className="soft-button" onClick={onCancel}>停止导入</button>
                : failed > 0 && <button type="button" className="soft-button" disabled={busy} onClick={onRetry}>重试失败（{failed}）</button>}
            </div>}
            <ul className="account-playlist-list">{visible.map((playlist) => {
              const status = statuses[playlist.id];
              return <li key={playlist.id} className={selected.has(playlist.id) ? 'is-selected' : undefined}>
                <input className="settings-checkbox is-small" type="checkbox" aria-label={`选择 ${playlist.name}`} checked={selected.has(playlist.id)}
                  disabled={busy} onChange={(event) => toggle([playlist.id], event.target.checked)} />
                <button type="button" className="account-playlist-preview" aria-label={`预览 ${playlist.name}`} onClick={() => onPreview(playlist)}>
                  <span className="account-playlist-cover">{playlist.coverUrl
                    ? <img src={playlist.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <ListMusic size={24} aria-hidden="true" />}</span>
                  <span className="account-playlist-copy"><span className="account-playlist-name">{playlist.name}</span>
                    <span className="account-playlist-meta">{playlist.trackCount} 首 · {playlist.kind === 'created' ? '创建的歌单' : '收藏的歌单'}</span>
                    {status && <span className={`account-import-state is-${status.state}`}>{status.message}</span>}
                  </span>
                  <span className="account-playlist-open">预览</span>
                </button>
                <button type="button" className="soft-button" disabled={busy} onClick={() => onImport([playlist])}>
                  <Download size={14} aria-hidden="true" />{status?.state === 'importing' ? '导入中…' : '导入到本地'}</button>
              </li>;
            })}</ul>
            <LibraryPagination label="歌单" page={page} total={playlists.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </>}
  </section>;
}
