import React from 'react';

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
 * retry button and a "clear local data and restart" escape hatch, so a broken
 * persisted state can never brick the whole window.
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
      localStorage.clear();
      sessionStorage.clear();
    } catch (storageError) {
      console.warn('[ErrorBoundary] 清除本地数据失败:', storageError);
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
              清除本地数据并重启
            </button>
          </div>
        </div>
      </div>
    );
  }
}
