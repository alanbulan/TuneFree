import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PlayerProvider } from './contexts/PlayerContext';
import { LibraryProvider } from './contexts/LibraryContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Library from './pages/Library';

const App: React.FC = () => {
  return (
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
  );
};

export default App;