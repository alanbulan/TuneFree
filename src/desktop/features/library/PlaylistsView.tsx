import { useMemo, useState } from 'react';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { importPlaylist, getPlaylistImportErrorMessage,
  PLAYLIST_IMPORT_SOURCES } from '../../../core/services/playlistImport';
import type { Playlist, Song } from '../../../core/types';
import { useDesktopDialog } from '../../components/DialogHost';
import { useToast } from '../../components/ToastHost';
import { PlaylistActionCards, PlaylistCard, PlaylistDetail } from './PlaylistViewParts';
import MotionPanel from '../../components/MotionPanel';

export default function PlaylistsView() {
  const { playlists, createPlaylist, deletePlaylist, renamePlaylist, removeFromPlaylist,
    isFavorite, toggleFavorite } = useLibrary();
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { confirmDialog, promptDialog } = useDesktopDialog();
  const { showToast } = useToast();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [importSource, setImportSource] = useState<string>(PLAYLIST_IMPORT_SOURCES[0].value);
  const [importInput, setImportInput] = useState('');
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);
  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    if (!toggleFavorite(song)) return;
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销', onClick: () => toggleFavorite(song),
    });
  };
  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    if (!createPlaylist(name)) return;
    setNewPlaylistName('');
    showToast(`已创建「${name}」`, 'success');
  };
  const handleImportPlaylist = async () => {
    if (isImportingPlaylist || !importInput.trim()) return;
    setIsImportingPlaylist(true);
    try {
      const payload = await importPlaylist(importSource, importInput);
      if (!createPlaylist(payload.name, payload.songs)) return;
      setImportInput('');
      showToast(`已导入「${payload.name}」共 ${payload.songs.length} 首`, 'success');
    } catch (error) {
      showToast(getPlaylistImportErrorMessage(error), 'error');
    } finally { setIsImportingPlaylist(false); }
  };
  const handleRenamePlaylist = async (playlist: Playlist) => {
    const nextName = await promptDialog({ title: '重命名歌单',
      message: `为「${playlist.name || '未命名歌单'}」输入新的名称。`, defaultValue: playlist.name,
      placeholder: '歌单名称', confirmLabel: '保存' });
    const name = nextName?.trim();
    if (!name || name === playlist.name) return;
    if (!renamePlaylist(playlist.id, name)) return;
    showToast(`已重命名为「${name}」`, 'success');
  };
  const handleDeletePlaylist = async (playlist: Playlist) => {
    const confirmed = await confirmDialog({ title: '删除歌单',
      message: `确定删除「${playlist.name || '未命名歌单'}」？歌单内歌曲不会从收藏或本地下载中删除。`,
      confirmLabel: '删除', tone: 'danger' });
    if (!confirmed) return;
    if (!deletePlaylist(playlist.id)) return;
    setSelectedPlaylistId(null); showToast('歌单已删除', 'success');
  };

  return (
    <MotionPanel transitionKey={selectedPlaylist?.id ?? 'grid'}>
    {selectedPlaylist ? <PlaylistDetail playlist={selectedPlaylist} currentSong={currentSong} isPlaying={isPlaying}
      onBack={() => setSelectedPlaylistId(null)} onRename={(playlist) => void handleRenamePlaylist(playlist)}
      onDelete={(playlist) => void handleDeletePlaylist(playlist)}
      onPlay={(song) => void playQueue(selectedPlaylist.songs, song)} onFavorite={handleFavorite}
      isFavorite={(song) => isFavorite(song.id, song.source)}
      onRemove={(song) => removeFromPlaylist(selectedPlaylist.id, song.id, song.source)} /> : (
    <section className="playlist-grid">
      <PlaylistActionCards newName={newPlaylistName} onNewNameChange={setNewPlaylistName}
        onCreate={handleCreatePlaylist} importSource={importSource} onImportSourceChange={setImportSource}
        importInput={importInput} onImportInputChange={setImportInput}
        isImporting={isImportingPlaylist} onImport={() => void handleImportPlaylist()} />
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} onOpen={() => setSelectedPlaylistId(playlist.id)} />
      ))}
    </section>
    )}
    </MotionPanel>
  );
}
