import React from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Search, Home, 
  ListMusic, MoreHorizontal, ChevronDown, Music2, AlertCircle,
  Heart, Plus, Share, Download, Upload, Trash2, Settings, Folder
} from 'lucide-react';

export const PlayIcon = ({ size = 24, className = "" }) => <Play size={size} className={className} fill="currentColor" />;
export const PauseIcon = ({ size = 24, className = "" }) => <Pause size={size} className={className} fill="currentColor" />;
export const NextIcon = ({ size = 24, className = "" }) => <SkipForward size={size} className={className} fill="currentColor" />;
export const PrevIcon = ({ size = 24, className = "" }) => <SkipBack size={size} className={className} fill="currentColor" />;
export const SearchIcon = ({ size = 24, className = "" }) => <Search size={size} className={className} />;
export const HomeIcon = ({ size = 24, className = "" }) => <Home size={size} className={className} />;
export const LibraryIcon = ({ size = 24, className = "" }) => <ListMusic size={size} className={className} />;
export const MoreIcon = ({ size = 24, className = "" }) => <MoreHorizontal size={size} className={className} />;
export const ChevronDownIcon = ({ size = 24, className = "" }) => <ChevronDown size={size} className={className} />;
export const MusicIcon = ({ size = 24, className = "" }) => <Music2 size={size} className={className} />;
export const ErrorIcon = ({ size = 24, className = "" }) => <AlertCircle size={size} className={className} />;

export const HeartIcon = ({ size = 24, className = "" }) => <Heart size={size} className={className} />;
export const HeartFillIcon = ({ size = 24, className = "" }) => <Heart size={size} className={className} fill="currentColor" />;
export const PlusIcon = ({ size = 24, className = "" }) => <Plus size={size} className={className} />;
export const ShareIcon = ({ size = 24, className = "" }) => <Share size={size} className={className} />;
export const DownloadIcon = ({ size = 24, className = "" }) => <Download size={size} className={className} />;
export const UploadIcon = ({ size = 24, className = "" }) => <Upload size={size} className={className} />;
export const TrashIcon = ({ size = 24, className = "" }) => <Trash2 size={size} className={className} />;
export const SettingsIcon = ({ size = 24, className = "" }) => <Settings size={size} className={className} />;
export const FolderIcon = ({ size = 24, className = "" }) => <Folder size={size} className={className} fill="currentColor" />;