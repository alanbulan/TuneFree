'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  dismissToast: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearToastTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast(null);
  }, [clearToastTimer]);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', action?: ToastAction) => {
      const id = Date.now();
      clearToastTimer();
      setToast({ id, message, tone, action });
      timeoutRef.current = window.setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current));
        timeoutRef.current = null;
      }, action ? 5200 : 3200);
    },
    [clearToastTimer],
  );

  useEffect(() => clearToastTimer, [clearToastTimer]);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={`toast-card toast-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  const action = toast.action;
                  dismissToast();
                  action?.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="关闭提示" onClick={dismissToast}>
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: () => {},
      dismissToast: () => {},
    } satisfies ToastContextType;
  }
  return context;
}
