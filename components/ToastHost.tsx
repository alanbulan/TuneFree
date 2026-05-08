import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

const ToastContext = createContext<ToastContextType | undefined>(undefined);
const TOAST_EVENT = 'tunefree:toast';

type ToastEventDetail = Pick<ToastState, 'message' | 'tone' | 'action'>;

const emitToast = (message: string, tone: ToastTone = 'info', action?: ToastAction) => {
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
    detail: { message, tone, action },
  }));
};

const toneClassName: Record<ToastTone, string> = {
  info: 'bg-neutral-900 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  error: 'bg-red-600 text-white',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearToastTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast(null);
  }, [clearToastTimer]);

  const displayToast = useCallback(
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

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', action?: ToastAction) => {
      displayToast(message, tone, action);
    },
    [displayToast],
  );

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastEventDetail>).detail;
      if (!detail?.message) return;
      displayToast(detail.message, detail.tone, detail.action);
    };
    window.addEventListener(TOAST_EVENT, handleToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToast);
      clearToastTimer();
    };
  }, [clearToastTimer, displayToast]);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed left-0 right-0 bottom-[calc(110px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 pointer-events-none" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={`pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-2xl animate-slide-up ${toneClassName[toast.tone]}`} role="status">
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => {
                  const action = toast.action;
                  dismissToast();
                  action?.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="shrink-0 text-lg leading-none text-white/80" aria-label="关闭提示" onClick={dismissToast}>
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: emitToast,
      dismissToast: () => {},
    } satisfies ToastContextType;
  }
  return context;
};
