import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { ErrorBoundary } from './core/components/ErrorBoundary';
import { isTauri } from './core/ipc';
import DesktopApp from './desktop/DesktopApp';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

if (isTauri() && /Macintosh|MacIntel/.test(navigator.userAgent)) {
  document.documentElement.classList.add('macos-rounded-window');
}

// 窗口不可见时给 <html> 挂上 .app-hidden，暂停全部装饰动画（见 app/styles/motion.css），
// 避免播放器常驻后台时持续消耗 GPU。
const syncVisibilityClass = () => {
  document.documentElement.classList.toggle('app-hidden', document.visibilityState === 'hidden');
};

syncVisibilityClass();
document.addEventListener('visibilitychange', syncVisibilityClass);

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DesktopApp />
    </ErrorBoundary>
  </StrictMode>,
);
