import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import MiniPlayer from './MiniPlayer';
import FullPlayer from './FullPlayer';
import { HomeIcon, SearchIcon, LibraryIcon } from './Icons';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen bg-ios-bg overflow-hidden relative">
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-32 no-scrollbar">
        {children}
      </main>

      {/* Mini Player */}
      <MiniPlayer onExpand={() => setIsFullPlayerOpen(true)} />

      {/* Full Player Overlay */}
      <FullPlayer isOpen={isFullPlayerOpen} onClose={() => setIsFullPlayerOpen(false)} />

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full glass border-t border-black/5 pb-safe z-30">
        <div className="flex justify-around items-center h-[55px]">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? 'text-ios-red' : 'text-ios-subtext'}`
            }
          >
            <HomeIcon size={24} />
            <span className="text-[10px] font-medium">首页</span>
          </NavLink>
          
          <NavLink 
            to="/search" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? 'text-ios-red' : 'text-ios-subtext'}`
            }
          >
            <SearchIcon size={24} />
            <span className="text-[10px] font-medium">搜索</span>
          </NavLink>

          <NavLink 
            to="/library" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? 'text-ios-red' : 'text-ios-subtext'}`
            }
          >
            <LibraryIcon size={24} />
            <span className="text-[10px] font-medium">我的</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
};

export default Layout;