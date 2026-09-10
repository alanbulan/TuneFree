import React from 'react';
import { PLAYER_STORAGE_KEYS } from '../contexts/playerPersistence';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const MAX_MESSAGE_LENGTH = 200;

const summarizeError = (error: Error): string => {
  const message = error.message || String(error);
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : message;
};

/**
 * 顶层渲染错误边界：中文兜底页 + 重试按钮 + 定向重置播放状态。
 * 重置只清播放队列 / 播放设置，收藏和歌单保留。
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] 界面渲染异常:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  handleClearAndRestart = () => {
    try {
      for (const key of Object.values(PLAYER_STORAGE_KEYS)) {
        localStorage.removeItem(key);
      }
    } catch (storageError) {
      console.warn('[ErrorBoundary] 重置播放状态失败:', storageError);
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-ios-bg px-6"
        role="alert"
      >
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center">
          <div className="w-16 h-16 bg-ios-red/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <span className="text-2xl">😵</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">应用出现异常</h1>
          <p className="text-sm text-gray-500 break-words mb-2">
            {summarizeError(error)}
          </p>
          <p className="text-xs text-gray-400 mb-6">
            重置会清除当前播放队列与播放设置，收藏和歌单会保留。
          </p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="w-full py-3 bg-black text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition"
            >
              重试
            </button>
            <button
              type="button"
              onClick={this.handleClearAndRestart}
              className="w-full py-3 bg-ios-red/5 text-ios-red rounded-xl font-medium text-sm active:scale-95 transition"
            >
              重置播放状态并重启
            </button>
          </div>
        </div>
      </div>
    );
  }
}
