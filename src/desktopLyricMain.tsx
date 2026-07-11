import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import DesktopLyricPage from '../app/desktop-lyric/page';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <DesktopLyricPage />
  </StrictMode>,
);

if ('__TAURI_INTERNALS__' in window) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('mark_desktop_lyric_ready'))
        .catch((error) => console.error('Failed to mark desktop lyric ready:', error));
    });
  });
}
