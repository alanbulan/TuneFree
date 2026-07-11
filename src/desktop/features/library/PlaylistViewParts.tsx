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
      <div className="content-card glass-panel" style={{ margin: '14px 0' }}>
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
      <div className="panel-field playlist-panel-field" style={{ position: 'relative', zIndex: 11 }}>
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
    tidal: 'TIDAL', qobuz: 'Qobuz', joox: 'JOOX', bilibili: 'B站',
    apple: 'Apple Music', ytmusic: 'YouTube Music', spotify: 'Spotify',
  };
  return labels[playlist.songs[0].source] || '本地';
};

export function PlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const coverUrl = playlist.songs[0]?.pic;
  const contentStyle: React.CSSProperties = coverUrl
    ? { position: 'relative', zIndex: 3, width: '100%', height: '100%', display: 'flex',
        flexDirection: 'column', gap: 12, flex: 1 }
    : { width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', flex: 1 };
  return (
    <button type="button" className={`library-card ${coverUrl ? 'has-cover' : ''}`}
      onClick={onOpen} style={coverUrl ? { position: 'relative', overflow: 'hidden', color: '#ffffff',
        border: 'none', minHeight: '270px' } : undefined}>
      {coverUrl && (<>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${coverUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(15px) brightness(0.65)',
          transform: 'scale(1.15)', zIndex: 1 }} />
        <div style={{ position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.4))', zIndex: 2 }} />
      </>)}
      <div style={contentStyle}>
        {coverUrl ? (
          <div style={{ width: '100%', paddingTop: '100%', position: 'relative', borderRadius: '16px',
            overflow: 'hidden', boxShadow: '0 8px 16px rgba(0,0,0,0.3)', marginBottom: 8 }}>
            <img src={coverUrl} alt={playlist.name} referrerPolicy={getImgReferrerPolicy(coverUrl)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : <span style={{ marginBottom: 22, display: 'inline-flex' }}><FolderIcon size={34} className="muted-text" /></span>}
        <h3 style={coverUrl ? { color: '#ffffff', fontSize: '15px', fontWeight: 'bold',
          margin: '4px 0 0 0', textShadow: '0 1px 3px rgba(0,0,0,0.6)' } : undefined}>
          {playlist.name || '未命名歌单'}
        </h3>
        <p style={coverUrl ? { color: 'rgba(255,255,255,0.75)', fontSize: '11px', margin: 0,
          textShadow: '0 1px 2px rgba(0,0,0,0.6)' } : undefined}>{playlist.songs.length} 首歌曲</p>
        <div className="library-card-meta" style={coverUrl ? { marginTop: 'auto' } : undefined}>
          <span className="source-badge" style={coverUrl ? { backgroundColor: 'rgba(255,255,255,0.2)',
            color: '#ffffff', backdropFilter: 'blur(4px)' } : undefined}>{getSourceLabel(playlist)}</span>
          <span className="muted-text" style={coverUrl ? { color: 'rgba(255,255,255,0.9)' } : undefined}>打开</span>
        </div>
      </div>
    </button>
  );
}
