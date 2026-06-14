
import React from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Search, Home,
  ListMusic, MoreHorizontal, ChevronDown, Music2, AlertCircle,
  Heart, Plus, Share, Download, Upload, Trash2, Settings, Folder,
  Repeat, Repeat1, Shuffle, List, PanelLeftClose, PanelLeftOpen, Key, Info, ExternalLink, Github, X,
  Code2, Boxes, FileCode2, Rocket, Cloud, Server, AudioWaveform, PanelsTopLeft, Database
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

export const RepeatIcon = ({ size = 24, className = "" }) => <Repeat size={size} className={className} />;
export const RepeatOneIcon = ({ size = 24, className = "" }) => <Repeat1 size={size} className={className} />;
export const ShuffleIcon = ({ size = 24, className = "" }) => <Shuffle size={size} className={className} />;
export const QueueIcon = ({ size = 24, className = "" }) => <List size={size} className={className} />;
export const SidebarCollapseIcon = ({ size = 24, className = "" }) => <PanelLeftClose size={size} className={className} />;
export const SidebarExpandIcon = ({ size = 24, className = "" }) => <PanelLeftOpen size={size} className={className} />;

// Fix: Added KeyIcon export to resolve Library.tsx import error
export const KeyIcon = ({ size = 24, className = "" }) => <Key size={size} className={className} />;
export const InfoIcon = ({ size = 24, className = "" }) => <Info size={size} className={className} />;
export const ExternalLinkIcon = ({ size = 24, className = "" }) => <ExternalLink size={size} className={className} />;
export const GithubIcon = ({ size = 24, className = "" }) => <Github size={size} className={className} />;
export const CloseIcon = ({ size = 24, className = "" }) => <X size={size} className={className} />;
export const CodeIcon = ({ size = 24, className = "" }) => <Code2 size={size} className={className} />;
export const BoxesIcon = ({ size = 24, className = "" }) => <Boxes size={size} className={className} />;
export const FileCodeIcon = ({ size = 24, className = "" }) => <FileCode2 size={size} className={className} />;
export const RocketIcon = ({ size = 24, className = "" }) => <Rocket size={size} className={className} />;
export const CloudIcon = ({ size = 24, className = "" }) => <Cloud size={size} className={className} />;
export const ServerIcon = ({ size = 24, className = "" }) => <Server size={size} className={className} />;
export const WaveformIcon = ({ size = 24, className = "" }) => <AudioWaveform size={size} className={className} />;
export const PanelsIcon = ({ size = 24, className = "" }) => <PanelsTopLeft size={size} className={className} />;
export const DatabaseIcon = ({ size = 24, className = "" }) => <Database size={size} className={className} />;
