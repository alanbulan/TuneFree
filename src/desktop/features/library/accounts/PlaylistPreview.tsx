import { Download, Pause, Play } from 'lucide-react';
import type { AccountPlatform, PlatformAccount, PlatformPlaylist } from '../../../../core/ipc';
import type { Song } from '../../../../core/types';
import { usePlayerActions, usePlayerNowPlaying } from '../../../../core/contexts/PlayerContext';
import { useLibrary } from '../../../../core/contexts/LibraryContext';
import DesktopModal from '../../../components/DesktopModal';
import SongTable from '../../../components/SongTable';
import { useToast } from '../../../components/ToastHost';
import LibraryPagination from '../components/LibraryPagination';
import { usePlaylistPreview } from './usePlaylistPreview';

interface Props {
  account: PlatformAccount;
  playlist: PlatformPlaylist;
  busy: boolean;
  onClose: () => void;
  onImport: (songs?: Song[]) => void;
  markExpired: (platform: AccountPlatform) => void;
}

export default function PlaylistPreview({ account, playlist, busy, onClose, onImport, markExpired }: Props) {
  const { togglePlay } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const model = usePlaylistPreview(account, playlist, markExpired);
  const { page, result, error, loading, songs, chosen } = model;
  const disabled = busy || model.working || loading || !!error || account.state === 'expired';

  return <DesktopModal title={playlist.name} className="account-preview-dialog" onClose={onClose}
    description={`${model.platformName} · ${playlist.kind === 'created' ? '创建的歌单' : '收藏的歌单'}`}
    actions={<><button type="button" className="soft-button" onClick={onClose}>关闭</button>
      <button type="button" className="soft-button" disabled={disabled || chosen.length === 0} onClick={() => onImport(chosen)}>
        <Download size={14} aria-hidden="true" />导入所选{chosen.length ? `（${chosen.length}）` : ''}</button>
      <button type="button" className="primary-button" disabled={disabled || result?.total === 0} onClick={() => onImport()}>
        <Download size={14} aria-hidden="true" />导入这个歌单</button></>}>
    <div className="account-preview-toolbar">
      <button type="button" className="primary-button" disabled={disabled || songs.length === 0} onClick={() => void model.playAll()}>
        <Play size={14} aria-hidden="true" />播放全部</button>
      <button type="button" className="soft-button" disabled={disabled || chosen.length === 0} onClick={() => void model.playSelected()}>
        <Play size={14} aria-hidden="true" />播放所选{chosen.length ? `（${chosen.length}）` : ''}</button>
      {currentSong?.source === account.platform && <button type="button" className="soft-button" onClick={togglePlay}>
        {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{isPlaying ? '暂停播放' : '继续播放'}</button>}
      {model.reading && <><span className="account-preview-summary" role="status">正在读取完整歌单…</span>
        <button type="button" className="soft-button" onClick={model.cancelRead}>取消读取</button></>}
    </div>
    <div className="account-selection-bar account-preview-selection">
      <label className="account-selection"><input type="checkbox" className="settings-checkbox is-small" aria-label="选择本页歌曲"
        checked={model.pageSelected} disabled={disabled || songs.length === 0} onChange={(event) => model.togglePage(event.target.checked)} />本页全选</label>
      <button type="button" className="account-text-button" disabled={disabled || !result?.total} onClick={() => void model.selectAll()}>选择全部 {result?.total ?? playlist.trackCount} 首</button>
      <span className="account-selection-count" role="status">已选 {chosen.length} 首</span>
      {chosen.length > 0 && <button type="button" className="account-text-button" disabled={model.working} onClick={model.clearSelection}>清空选择</button>}
    </div>
    {model.actionError && <p className="account-error" role="alert">{model.actionError}</p>}
    <div className="account-preview-body" aria-busy={loading}>
      {loading ? <p className="account-loading" role="status">正在读取第 {page} 页歌曲…</p>
        : error ? <div className="account-playlist-error"><p className="account-error" role="alert">{error}</p>
          <button type="button" className="soft-button" onClick={model.retry}>重新读取歌曲</button></div>
          : <SongTable songs={songs} currentSong={currentSong} isPlaying={isPlaying} emptyText="这份歌单没有可读取的歌曲。"
            onPlay={(song) => { if (!disabled) void model.playAll(song); }} isFavorite={(song) => isFavorite(song.id, song.source)}
            selection={{ isSelected: model.isSelected, onToggle: model.toggleSong, disabled }}
            onFavorite={(song) => {
              const wasFavorite = isFavorite(song.id, song.source);
              if (toggleFavorite(song)) showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success');
            }} />}
    </div>
    {result && <LibraryPagination label="歌曲" page={page} total={result.total} pageSize={result.pageSize} disabled={loading || model.working} onChange={model.setPage} />}
  </DesktopModal>;
}
