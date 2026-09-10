import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { PlayerProvider } from './contexts/PlayerContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { ToastProvider } from './components/ToastHost';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Library from './pages/Library';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <LibraryProvider>
          <PlayerProvider>
            <HashRouter>
              <Layout>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </HashRouter>
          </PlayerProvider>
        </LibraryProvider>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;