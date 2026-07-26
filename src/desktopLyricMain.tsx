import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 歌词窗口只引这三层样式：绝不引 globals.css，否则 body 的渐变背景会毁掉窗口透明度
import '../app/styles/tokens.css';
import '../app/styles/lyrics.css';
import '../app/desktop-lyric/desktop-lyric.css';
import DesktopLyricPage from '../app/desktop-lyric/page';
import { ErrorBoundary } from './core/components/ErrorBoundary';
import { emitEventTo, invokeCommand, isTauri } from './core/ipc';

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

if (isTauri()) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void invokeCommand('mark_desktop_lyric_ready').catch((error) => {
        console.error('Failed to mark desktop lyric ready:', error);
      });
      // 主窗口据此补发一次 lyric-song / lyric-tick，避免暂停时开窗停留在空白。
      void emitEventTo('main', 'desktop-lyric-ready', undefined).catch((error) => {
        console.error('Failed to announce desktop lyric readiness:', error);
      });
    });
  });
}
