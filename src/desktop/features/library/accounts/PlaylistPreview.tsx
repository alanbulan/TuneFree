import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { toIpcError, type AccountPlatform, type PlatformAccount, type PlatformPlaylist, type PlatformPlaylistPreview } from '../../../../core/ipc';
import { accountPlatformName, importedPlatformSongs, platformAccounts } from '../../../../core/services/platformAccounts';
import { usePlayerActions, usePlayerNowPlaying } from '../../../../core/contexts/PlayerContext';
import { useLibrary } from '../../../../core/contexts/LibraryContext';
import DesktopModal from '../../../components/DesktopModal';
import SongTable from '../../../components/SongTable';
import { useToast } from '../../../components/ToastHost';
import LibraryPagination from '../components/LibraryPagination';

interface Props {
  account: PlatformAccount;
  playlist: PlatformPlaylist;
  busy: boolean;
  onClose: () => void;
  onImport: () => void;
  markExpired: (platform: AccountPlatform) => void;
}

export default function PlaylistPreview({ account, playlist, busy, onClose, onImport, markExpired }: Props) {
  const { playQueue, togglePlay } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<PlatformPlaylistPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const version = useRef(0);
  const songs = useMemo(() => result ? importedPlatformSongs(result) : [], [result]);
  useEffect(() => {
    const current = ++version.current;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const next = await platformAccounts.preview(account.platform, playlist.id, page);
        if (current === version.current) setResult(next);
      } catch (failure) {
        if (current !== version.current) return;
        const parsed = toIpcError(failure); setError(parsed.message);
        if (parsed.code === 'AUTH_REQUIRED') markExpired(account.platform);
      } finally { if (current === version.current) setLoading(false); }
    };
    // A retry intentionally performs the same page request again.
    void Promise.resolve(retry).then(load);
    return () => { version.current += 1; };
  }, [account.platform, playlist.id, page, retry, markExpired]);

  return <DesktopModal title={playlist.name} className="account-preview-dialog" onClose={onClose}
    description={`${accountPlatformName(account.platform)} · ${playlist.kind === 'created' ? '创建的歌单' : '收藏的歌单'} · 点击歌曲直接播放`}
    actions={<><button type="button" className="soft-button" onClick={onClose}>关闭</button>
      <button type="button" className="primary-button" disabled={busy || loading || !!error || result?.total === 0} onClick={onImport}>
        <Download size={14} aria-hidden="true" />导入这个歌单</button></>}>
    <div className="account-preview-toolbar">
      <button type="button" className="primary-button" disabled={loading || !!error || songs.length === 0} onClick={() => void playQueue(songs)}>
        <Play size={14} aria-hidden="true" />播放本页</button>
      {currentSong?.source === account.platform && <button type="button" className="soft-button" onClick={togglePlay}>
        {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{isPlaying ? '暂停播放' : '继续播放'}</button>}
      <p className="account-preview-summary">{result ? `共 ${result.total} 首 · 每页 ${result.pageSize} 首` : '按页读取歌曲'} · 优先使用平台账号播放</p>
    </div>
    <div className="account-preview-body" aria-busy={loading}>
      {loading ? <p className="account-loading" role="status">正在读取第 {page} 页歌曲…</p>
        : error ? <div className="account-playlist-error"><p className="account-error" role="alert">{error}</p>
          <button type="button" className="soft-button" onClick={() => setRetry((value) => value + 1)}>重新读取歌曲</button></div>
          : <SongTable songs={songs} currentSong={currentSong} isPlaying={isPlaying} emptyText="这份歌单没有可读取的歌曲。"
            onPlay={(song) => void playQueue(songs, song)} isFavorite={(song) => isFavorite(song.id, song.source)}
            onFavorite={(song) => {
              const wasFavorite = isFavorite(song.id, song.source);
              if (toggleFavorite(song)) showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success');
            }} />}
    </div>
    {result && <LibraryPagination label="歌曲" page={page} total={result.total} pageSize={result.pageSize} disabled={loading} onChange={setPage} />}
  </DesktopModal>;
}
