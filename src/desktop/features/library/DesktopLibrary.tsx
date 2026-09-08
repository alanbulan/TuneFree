import { useLibrary } from '../../../core/contexts/LibraryContext';
import type { LibraryView } from '../../types';
import FavoritesView from './FavoritesView';
import PlaylistsView from './PlaylistsView';
import DownloadsView from './DownloadsView';
import SettingsView from './SettingsView';
import AboutView from './AboutView';

const viewMeta: Record<LibraryView, { description: string; title: string }> = {
  favorites: { description: '把喜欢的旋律留在身边。', title: '我的收藏' },
  playlists: { description: '为不同的心情，收藏不同的声音。', title: '我的歌单' },
  downloads: { description: '保存到本地，随时都能听。', title: '下载' },
  settings: { description: '让 TuneFree 更合你的习惯。', title: '设置' },
  about: { description: '版本信息、技术栈与开源致谢。', title: '关于' },
};

interface DesktopLibraryProps {
  activeView: LibraryView;
}

export default function DesktopLibrary({ activeView }: DesktopLibraryProps) {
  // Ensure LibraryProvider is initialised – the individual views read from
  // the same context but we keep this call so the provider is always
  // touched at the library root.
  useLibrary();

  const meta = viewMeta[activeView];

  return (
    <div>
      <div className="page-header library-page-header">
        <div>
          <h1 className="page-title">{meta.title}</h1>
          <p className="page-description">{meta.description}</p>
        </div>
      </div>

      {activeView === 'favorites' && <FavoritesView />}
      {activeView === 'playlists' && <PlaylistsView />}
      {activeView === 'downloads' && <DownloadsView />}
      {activeView === 'settings' && <SettingsView />}
      {activeView === 'about' && <AboutView />}
    </div>
  );
}
