import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import DesktopApp from './desktop/DesktopApp';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
