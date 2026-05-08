import React, { useState, useEffect } from 'react';
import { Song } from '../types';
import { DownloadIcon, MusicIcon } from './Icons';
// Changed getDownloadUrl to getSongUrl as it is the correct function name in api.ts
import { getSongUrl, triggerDownload, getImgReferrerPolicy } from '../services/api';
import { useToast } from './ToastHost';

interface DownloadPopupProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
}

const QUALITY_MAP: Record<string, { label: string, desc: string, ext: string }> = {
  '128k': { label: '标准音质', desc: '128kbps / MP3', ext: 'mp3' },
  '320k': { label: '高品质', desc: '320kbps / MP3', ext: 'mp3' },
  'flac': { label: '无损音质', desc: 'FLAC', ext: 'flac' },
  'flac24bit': { label: 'Hi-Res', desc: '24bit FLAC', ext: 'flac' },
};

const DownloadPopup: React.FC<DownloadPopupProps> = ({ isOpen, onClose, song }) => {
  const [downloadingType, setDownloadingType] = useState<string | null>(null);
  const { showToast } = useToast();

  // 弹窗打开时锁定背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen || !song) return null;

  // Determine available qualities. If song.types is missing, show standard options.
  const availableTypes = song.types && song.types.length > 0
    ? song.types
    : ['128k', '320k', 'flac', 'flac24bit'];

  const handleDownload = async (type: string) => {
    if (downloadingType) return;
    setDownloadingType(type);
    try {
      const url = await getSongUrl(song.id, song.source, type);
      if (!url) {
        showToast('无法获取下载地址', 'error');
        return;
      }
      const meta = QUALITY_MAP[type] || { ext: 'mp3' };
      const filename = `${song.artist} - ${song.name}.${meta.ext}`;
      triggerDownload(url, filename);
      showToast('已开始下载', 'success');
      onClose();
    } catch {
      showToast('下载失败，请稍后再试', 'error');
    } finally {
      setDownloadingType(null);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[70] backdrop-blur-sm transition-opacity touch-auto"
        onClick={onClose}
        onPointerDown={e => e.stopPropagation()}
      />

      <div
        className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[71] p-6 pb-safe shadow-2xl animate-slide-up touch-auto"
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                {song.pic ? (
                    <img src={song.pic} referrerPolicy={getImgReferrerPolicy(song.pic)} className="w-full h-full object-cover" />
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
                        disabled={!!downloadingType}
                        className={`w-full flex items-center justify-between p-4 bg-gray-50 rounded-xl transition ${downloadingType ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-100 active:bg-gray-200'}`}
                    >
                        <div className="flex flex-col items-start">
                            <span className="font-bold text-gray-800">{info.label}</span>
                            <span className="text-xs text-gray-400">{info.desc}</span>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-400 shadow-sm">
                            {downloadingType === type ? (
                                <div className="w-4 h-4 border-2 border-gray-300 border-t-ios-red rounded-full animate-spin" />
                            ) : (
                                <DownloadIcon size={16} />
                            )}
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