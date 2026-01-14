
import React from 'react';
import { Song } from '../types';
import { DownloadIcon, MusicIcon } from './Icons';
import { getDownloadUrl, triggerDownload } from '../services/api';

interface DownloadPopupProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
}

const QUALITY_MAP: Record<string, { label: string, desc: string, ext: string }> = {
  '128k': { label: '标准音质', desc: '128kbps / MP3', ext: 'mp3' },
  '320k': { label: '高品质', desc: '320kbps / MP3', ext: 'mp3' },
  'flac': { label: '无损音质', desc: 'FLAC', ext: 'flac' },
  'flac24bit': { label: 'Hi-Res', desc: '24bit / FLAC', ext: 'flac' }
};

const DownloadPopup: React.FC<DownloadPopupProps> = ({ isOpen, onClose, song }) => {
  if (!isOpen || !song) return null;

  // Determine available qualities. If song.types is missing, show standard options.
  const availableTypes = song.types && song.types.length > 0 
    ? song.types 
    : ['128k', '320k', 'flac'];

  const handleDownload = (type: string) => {
    const url = getDownloadUrl(song.id, song.source, type);
    const meta = QUALITY_MAP[type] || { ext: 'mp3' };
    const filename = `${song.artist} - ${song.name}.${meta.ext}`;
    triggerDownload(url, filename);
    onClose();
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/40 z-[70] backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[71] p-6 pb-safe shadow-2xl animate-slide-up">
        <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                {song.pic ? (
                    <img src={song.pic} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <MusicIcon size={24} />
                    </div>
                )}
            </div>
            <div>
                <h3 className="font-bold text-lg truncate pr-4">{song.name}</h3>
                <p className="text-xs text-gray-500">选择下载音质</p>
            </div>
        </div>

        <div className="space-y-3">
            {availableTypes.map((type) => {
                const info = QUALITY_MAP[type] || { label: type.toUpperCase(), desc: '未知格式', ext: 'mp3' };
                return (
                    <button 
                        key={type}
                        onClick={() => handleDownload(type)}
                        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-xl transition"
                    >
                        <div className="flex flex-col items-start">
                            <span className="font-bold text-gray-800">{info.label}</span>
                            <span className="text-xs text-gray-400">{info.desc}</span>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-400 shadow-sm">
                            <DownloadIcon size={16} />
                        </div>
                    </button>
                )
            })}
        </div>

        <button 
            onClick={onClose}
            className="w-full mt-6 py-4 text-center font-bold text-gray-500 bg-white border border-gray-100 rounded-xl active:bg-gray-50"
        >
            取消
        </button>
      </div>
    </>
  );
};

export default DownloadPopup;
