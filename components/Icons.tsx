
import React from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Search, House,
  ListMusic, Ellipsis, ChevronDown, Music2, CircleAlert,
  Heart, Plus, Share, Download, Upload, Trash, Settings, Folder,
  Repeat, Repeat1, Shuffle, List, Key, Info, ExternalLink, Check, Link
} from 'lucide-react';

export const PlayIcon = ({ size = 24, className = "" }) => <Play size={size} className={className} fill="currentColor" />;
export const PauseIcon = ({ size = 24, className = "" }) => <Pause size={size} className={className} fill="currentColor" />;
export const NextIcon = ({ size = 24, className = "" }) => <SkipForward size={size} className={className} fill="currentColor" />;
export const PrevIcon = ({ size = 24, className = "" }) => <SkipBack size={size} className={className} fill="currentColor" />;
export const SearchIcon = ({ size = 24, className = "" }) => <Search size={size} className={className} />;
export const HomeIcon = ({ size = 24, className = "" }) => <House size={size} className={className} />;
export const LibraryIcon = ({ size = 24, className = "" }) => <ListMusic size={size} className={className} />;
export const MoreIcon = ({ size = 24, className = "" }) => <Ellipsis size={size} className={className} />;
export const ChevronDownIcon = ({ size = 24, className = "" }) => <ChevronDown size={size} className={className} />;
export const MusicIcon = ({ size = 24, className = "" }) => <Music2 size={size} className={className} />;
export const ErrorIcon = ({ size = 24, className = "" }) => <CircleAlert size={size} className={className} />;

export const HeartIcon = ({ size = 24, className = "" }) => <Heart size={size} className={className} />;
export const HeartFillIcon = ({ size = 24, className = "" }) => <Heart size={size} className={className} fill="currentColor" />;
export const PlusIcon = ({ size = 24, className = "" }) => <Plus size={size} className={className} />;
export const ShareIcon = ({ size = 24, className = "" }) => <Share size={size} className={className} />;
export const DownloadIcon = ({ size = 24, className = "" }) => <Download size={size} className={className} />;
export const UploadIcon = ({ size = 24, className = "" }) => <Upload size={size} className={className} />;
export const TrashIcon = ({ size = 24, className = "" }) => <Trash size={size} className={className} />;
export const SettingsIcon = ({ size = 24, className = "" }) => <Settings size={size} className={className} />;
export const FolderIcon = ({ size = 24, className = "" }) => <Folder size={size} className={className} fill="currentColor" />;

export const RepeatIcon = ({ size = 24, className = "" }) => <Repeat size={size} className={className} />;
export const RepeatOneIcon = ({ size = 24, className = "" }) => <Repeat1 size={size} className={className} />;
export const ShuffleIcon = ({ size = 24, className = "" }) => <Shuffle size={size} className={className} />;
export const QueueIcon = ({ size = 24, className = "" }) => <List size={size} className={className} />;

// Fix: Added KeyIcon export to resolve Library.tsx import error
export const KeyIcon = ({ size = 24, className = "" }) => <Key size={size} className={className} />;
export const InfoIcon = ({ size = 24, className = "" }) => <Info size={size} className={className} />;
export const ExternalLinkIcon = ({ size = 24, className = "" }) => <ExternalLink size={size} className={className} />;
// lucide 1.x 移除了品牌图标，内联 GitHub mark 保留原有视觉
export const GithubIcon = ({ size = 24, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
  </svg>
);
export const CheckIcon = ({ size = 24, className = "" }) => <Check size={size} className={className} />;
export const LinkIcon = ({ size = 24, className = "" }) => <Link size={size} className={className} />;
