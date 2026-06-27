import { useLibrary } from '../../../core/contexts/LibraryContext';
import type { LibraryView } from '../../types';
import FavoritesView from './FavoritesView';
import PlaylistsView from './PlaylistsView';
import DownloadsView from './DownloadsView';
import SettingsView from './SettingsView';
import AboutView from './AboutView';

const viewMeta: Record<LibraryView, { eyebrow: string; title: string }> = {
  favorites: { eyebrow: 'Your Collection', title: '收藏' },
  playlists: { eyebrow: 'Playlists', title: '歌单' },
  downloads: { eyebrow: 'Offline Library', title: '下载' },
  settings: { eyebrow: 'Control Panel', title: '管理' },
  about: { eyebrow: 'About TuneFree', title: '关于' },
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
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1 className="page-title">{meta.title}</h1>
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
