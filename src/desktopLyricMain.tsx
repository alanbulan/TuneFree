import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 歌词窗口只引这三层样式：绝不引 globals.css，否则 body 的渐变背景会毁掉窗口透明度
import '../app/styles/tokens.css';
import '../app/styles/lyrics.css';
import '../app/desktop-lyric/desktop-lyric.css';
import DesktopLyricPage from '../app/desktop-lyric/page';
import { ErrorBoundary } from './core/components/ErrorBoundary';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DesktopLyricPage />
    </ErrorBoundary>
  </StrictMode>,
);
