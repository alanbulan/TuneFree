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
