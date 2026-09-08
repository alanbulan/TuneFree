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
 * Top-level render error boundary. Shows a Chinese fallback screen with a
 * retry button and a targeted playback reset that preserves the user library.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
      for (const key of Object.values(PLAYER_STORAGE_KEYS)) localStorage.removeItem(key);
    } catch (storageError) {
      console.warn('[ErrorBoundary] 重置播放状态失败:', storageError);
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1 className="error-boundary-title">应用出现异常</h1>
          <p className="error-boundary-message">{summarizeError(error)}</p>
          <p>重置会清除当前播放队列与播放设置，收藏和歌单会保留。</p>
          <div className="error-boundary-actions">
            <button
              type="button"
              className="error-boundary-button error-boundary-button-primary"
              onClick={this.handleRetry}
            >
              重试
            </button>
            <button
              type="button"
              className="error-boundary-button error-boundary-button-danger"
              onClick={this.handleClearAndRestart}
            >
              重置播放状态并重启
            </button>
          </div>
        </div>
      </div>
    );
  }
}
