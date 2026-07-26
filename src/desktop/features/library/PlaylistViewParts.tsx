import { ExternalLinkIcon, FolderIcon, PlusIcon } from '../../../core/components/Icons';
import { getImgReferrerPolicy } from '../../../core/services/utils';
import type { Playlist, Song } from '../../../core/types';
import SongTable from '../../components/SongTable';
import CustomSelect from './components/CustomSelect';
import { PLAYLIST_IMPORT_SOURCES } from '../../../core/services/playlistImport';

interface PlaylistDetailProps {
  playlist: Playlist;
  currentSong: Song | null;
  isPlaying: boolean;
  onBack: () => void;
  onRename: (playlist: Playlist) => void;
  onDelete: (playlist: Playlist) => void;
  onPlay: (song: Song) => void;
  onFavorite: (song: Song) => void;
  isFavorite: (song: Song) => boolean;
  onRemove: (song: Song) => void;
}

export function PlaylistDetail({ playlist, currentSong, isPlaying, onBack, onRename,
  onDelete, onPlay, onFavorite, isFavorite, onRemove }: PlaylistDetailProps) {
  return (
    <div>
      <button type="button" className="soft-button" onClick={onBack}>← 返回歌单列表</button>
      <div className="content-card glass-panel playlist-detail-card">
        <div className="panel-label-row">
          <div><p className="eyebrow">Playlist</p><h2 className="section-title">{playlist.name}</h2>
            <p>{playlist.songs.length} 首歌曲</p></div>
          <div className="inline-actions">
            {playlist.id !== 'favorites' && (<>
              <button type="button" className="soft-button" onClick={() => onRename(playlist)}>重命名</button>
              <button type="button" className="danger-button" onClick={() => onDelete(playlist)}>删除歌单</button>
            </>)}
          </div>
        </div>
      </div>
      <SongTable songs={playlist.songs} currentSong={currentSong} isPlaying={isPlaying}
        emptyText="这个歌单还没有歌曲" actionLabel="操作" onPlay={onPlay}
        onFavorite={onFavorite} isFavorite={isFavorite} onDelete={onRemove} deleteLabel="从歌单移除" />
    </div>
  );
}

interface ActionCardsProps {
  newName: string;
  onNewNameChange: (value: string) => void;
  onCreate: () => void;
  importSource: string;
  onImportSourceChange: (value: string) => void;
  importInput: string;
  onImportInputChange: (value: string) => void;
  isImporting: boolean;
  onImport: () => void;
}

export function PlaylistActionCards(props: ActionCardsProps) {
  return (<>
    <div className="create-card playlist-action-card"><div className="playlist-action-card-body">
      <span className="playlist-card-icon"><PlusIcon size={36} /></span>
      <div className="playlist-action-copy"><p className="eyebrow">Create</p><h3>新建歌单</h3>
        <p>从空白歌单开始整理收藏，适合按场景或心情归类。</p></div>
      <div className="panel-field playlist-panel-field">
        <input className="panel-input" value={props.newName}
          onChange={(event) => props.onNewNameChange(event.target.value)} placeholder="歌单名称" />
      </div>
      <button type="button" className="primary-button playlist-card-button" onClick={props.onCreate}>创建</button>
    </div></div>
    <div className="create-card playlist-action-card"><div className="playlist-action-card-body">
      <span className="playlist-card-icon"><ExternalLinkIcon size={36} /></span>
      <div className="playlist-action-copy"><p className="eyebrow">Import</p><h3>导入在线歌单</h3>
        <p>粘贴网易云 / QQ / 酷我的歌单链接或 ID，导入为本地歌单。</p></div>
      <div className="panel-field playlist-panel-field playlist-import-source-field">
        <CustomSelect value={props.importSource} options={PLAYLIST_IMPORT_SOURCES}
          onChange={props.onImportSourceChange} />
      </div>
      <div className="panel-field playlist-panel-field">
        <input className="panel-input" value={props.importInput}
          onChange={(event) => props.onImportInputChange(event.target.value)} placeholder="歌单链接或 ID"
          onKeyDown={(event) => event.key === 'Enter' && props.onImport()} />
      </div>
      <button type="button" className="primary-button playlist-card-button"
        disabled={props.isImporting || !props.importInput.trim()} onClick={props.onImport}>
        {props.isImporting ? '导入中…' : '导入'}
      </button>
    </div></div>
  </>);
}

const getSourceLabel = (playlist: Playlist): string => {
  if (playlist.id === 'favorites' || !playlist.songs?.length) return '本地';
  const labels: Record<string, string> = {
    netease: '网易云', tencent: 'QQ音乐', qq: 'QQ音乐', kuwo: '酷我音乐',
    joox: 'JOOX', bilibili: 'B站', apple: 'Apple Music', ytmusic: 'YouTube', spotify: 'Spotify',
  };
  return labels[playlist.songs[0].source] || '本地';
};

export function PlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const coverUrl = playlist.songs[0]?.pic;
  return (
    <button type="button" className={`library-card ${coverUrl ? 'has-cover' : ''}`} onClick={onOpen}>
      {coverUrl && (<>
        {/* 封面 URL 是运行时值，只有 background-image 保留内联 */}
        <div className="playlist-card-backdrop" style={{ backgroundImage: `url(${coverUrl})` }} />
        <div className="playlist-card-scrim" />
      </>)}
      <div className="playlist-card-content">
        {coverUrl ? (
          <div className="playlist-card-cover">
            <img src={coverUrl} alt={playlist.name} referrerPolicy={getImgReferrerPolicy(coverUrl)} />
          </div>
        ) : <span className="playlist-card-placeholder"><FolderIcon size={34} className="muted-text" /></span>}
        <h3>{playlist.name || '未命名歌单'}</h3>
        <p>{playlist.songs.length} 首歌曲</p>
        <div className="library-card-meta">
          <span className="source-badge">{getSourceLabel(playlist)}</span>
          <span className="muted-text">打开</span>
        </div>
      </div>
    </button>
  );
}
