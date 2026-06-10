import React, { useState, useEffect } from 'react';
import { Song, getSongKey } from '../types';
import { DownloadIcon, MusicIcon, CheckIcon } from './Icons';
// Changed getDownloadUrl to getSongUrl as it is the correct function name in api.ts
import { getSongUrl, triggerDownload, getImgReferrerPolicy } from '../services/api';
import {
  downloadSongOffline,
  getOfflineQualities,
} from '../services/offlineDownloads';
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

type DownloadMode = 'offline' | 'file';

const DownloadPopup: React.FC<DownloadPopupProps> = ({ isOpen, onClose, song }) => {
  const [downloadingType, setDownloadingType] = useState<string | null>(null);
  const [mode, setMode] = useState<DownloadMode>('offline');
  const [offlineQualities, setOfflineQualities] = useState<string[]>([]);
  const { showToast } = useToast();

  // 弹窗打开时锁定背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // 打开时加载该歌曲已缓存的音质，用于显示「已缓存」标记
  useEffect(() => {
    if (!isOpen || !song) return;
    let cancelled = false;
    getOfflineQualities(song).then((qualities) => {
      if (!cancelled) setOfflineQualities(qualities);
    });
    return () => { cancelled = true; };
  }, [isOpen, song && getSongKey(song)]);

  if (!isOpen || !song) return null;

  // Determine available qualities. If song.types is missing, show standard options.
  const availableTypes = song.types && song.types.length > 0
    ? song.types
    : ['128k', '320k', 'flac', 'flac24bit'];

  const handleSaveFile = async (type: string) => {
    const url = await getSongUrl(song.id, song.source, type, song);
    if (!url) {
      showToast('无法获取下载地址', 'error');
      return;
    }
    const meta = QUALITY_MAP[type] || { ext: 'mp3' };
    const filename = `${song.artist} - ${song.name}.${meta.ext}`;
    triggerDownload(url, filename);
    showToast('已开始下载', 'success');
    onClose();
  };

  const handleSaveOffline = async (type: string) => {
    const result = await downloadSongOffline(song, type);
    if (result === 'exists') {
      showToast('该音质已在离线库中', 'info');
      return;
    }
    setOfflineQualities((prev) => [...prev, type]);
    showToast('已缓存到离线库，播放时将优先使用本地文件', 'success');
  };

  const handleDownload = async (type: string) => {
    if (downloadingType) return;
    setDownloadingType(type);
    try {
      if (mode === 'offline') {
        await handleSaveOffline(type);
      } else {
        await handleSaveFile(type);
      }
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
        <div className="flex items-center space-x-3 mb-4">
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

        <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
            {([
                { value: 'offline', label: '离线缓存' },
                { value: 'file', label: '另存文件' },
            ] as Array<{ value: DownloadMode; label: string }>).map((option) => (
                <button
                    key={option.value}
                    onClick={() => setMode(option.value)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${mode === option.value ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
                >
                    {option.label}
                </button>
            ))}
        </div>
        {mode === 'offline' && (
            <p className="text-[10px] text-gray-400 mb-3 leading-tight">
                缓存到浏览器离线库，播放时优先使用本地文件，无需重复解析。
            </p>
        )}

        <div className="space-y-3">
            {availableTypes.map((type) => {
                const info = QUALITY_MAP[type] || { label: type.toUpperCase(), desc: '未知格式', ext: 'mp3' };
                const isCached = offlineQualities.includes(type);
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
                        <div className="flex items-center gap-2">
                            {mode === 'offline' && isCached && (
                                <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已缓存</span>
                            )}
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-400 shadow-sm">
                                {downloadingType === type ? (
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-ios-red rounded-full animate-spin" />
                                ) : mode === 'offline' && isCached ? (
                                    <CheckIcon size={16} className="text-green-600" />
                                ) : (
                                    <DownloadIcon size={16} />
                                )}
                            </div>
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
