import { Download, ListMusic, RefreshCw } from 'lucide-react';
import type { AccountPlatform, PlatformAccount, PlatformPlaylist } from '../../../../core/ipc';
import { accountPlatformName } from '../../../../core/services/platformAccounts';

interface Props {
  accounts: PlatformAccount[];
  account: PlatformAccount | null;
  loading: boolean;
  error: string;
  playlists: PlatformPlaylist[];
  importingId: string | null;
  onSelect: (platform: AccountPlatform) => void;
  onReload: () => void;
  onImport: (playlist: PlatformPlaylist) => void;
}

export default function AccountPlaylists({ accounts, account, loading, error, playlists, importingId, onSelect, onReload, onImport }: Props) {
  if (!account) return <div className="accounts-empty">
    <ListMusic size={38} aria-hidden="true" /><h2>你的音乐，在轻一点的地方</h2>
    <p>连接后查看自己的歌单，再选择导入。</p><span>两平台可同时连接 · 导入后保留本地副本</span>
  </div>;
  return <section className="account-playlists" aria-label="平台歌单">
    <div className="account-playlist-heading">
      <div><h2>{accountPlatformName(account.platform)}的歌单</h2><p>选择导入，保留一份本地副本。</p></div>
      <div className="account-playlist-tools">
        {accounts.length > 1 && <select className="panel-select account-platform-select" value={account.platform} aria-label="查看哪个平台的歌单" onChange={(event) => onSelect(event.target.value as AccountPlatform)}>
          {accounts.map((item) => <option key={item.platform} value={item.platform}>{accountPlatformName(item.platform)}</option>)}
        </select>}
        <button type="button" className="soft-button" disabled={loading || importingId !== null || account.state === 'expired'} onClick={onReload}>
          <RefreshCw size={14} className={loading ? 'account-spinner' : ''} aria-hidden="true" /> {loading ? '读取歌单中…' : '刷新歌单'}
        </button>
      </div>
    </div>
    {account.state === 'expired' ? <p className="account-error" role="alert">连接已失效，请重新登录后读取歌单。已导入的本地歌单仍可使用。</p>
      : error ? <div className="account-playlist-error"><p className="account-error" role="alert">{error}</p><button type="button" className="soft-button" onClick={onReload}>重新读取歌单</button></div>
        : loading ? <p className="account-loading" role="status">正在读取创建和收藏的歌单…</p>
          : playlists.length === 0 ? <p className="account-loading">这个账号还没有可读取的歌单。</p>
            : <ul className="account-playlist-list">{playlists.map((playlist) => <li key={playlist.id}>
              <span className="account-playlist-cover">{playlist.coverUrl
                ? <img src={playlist.coverUrl} alt="" referrerPolicy="no-referrer" /> : <ListMusic size={24} aria-hidden="true" />}</span>
              <div className="account-playlist-copy"><h3>{playlist.name}</h3><p>{playlist.trackCount} 首 · {playlist.kind === 'created' ? '创建的歌单' : '收藏的歌单'}</p></div>
              <button type="button" className="soft-button" disabled={importingId !== null} onClick={() => onImport(playlist)}>
                <Download size={14} aria-hidden="true" /> {importingId === playlist.id ? '导入中…' : '导入到本地'}
              </button>
            </li>)}</ul>}
  </section>;
}
