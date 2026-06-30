'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

type DialogTone = 'default' | 'danger';

interface BaseDialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

interface PromptDialogOptions extends BaseDialogOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface ConfirmDialogState extends BaseDialogOptions {
  id: number;
  kind: 'confirm';
  resolve: (value: boolean) => void;
}

interface PromptDialogState extends PromptDialogOptions {
  id: number;
  kind: 'prompt';
  resolve: (value: string | null) => void;
}

type DialogState = ConfirmDialogState | PromptDialogState;

interface DialogContextType {
  confirmDialog: (options: BaseDialogOptions) => Promise<boolean>;
  promptDialog: (options: PromptDialogOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextType | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const closeDialog = useCallback((value: boolean | string | null) => {
    setDialog((current) => {
      if (!current) return null;
      if (current.kind === 'confirm') current.resolve(Boolean(value));
      else current.resolve(typeof value === 'string' ? value : null);
      return null;
    });
  }, []);

  const confirmDialog = useCallback((options: BaseDialogOptions) => (
    new Promise<boolean>((resolve) => {
      setDialog({
        id: Date.now(),
        kind: 'confirm',
        confirmLabel: '确认',
        cancelLabel: '取消',
        tone: 'default',
        ...options,
        resolve,
      });
    })
  ), []);

  const promptDialog = useCallback((options: PromptDialogOptions) => (
    new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue || '');
      setDialog({
        id: Date.now(),
        kind: 'prompt',
        confirmLabel: '保存',
        cancelLabel: '取消',
        tone: 'default',
        ...options,
        resolve,
      });
    })
  ), []);

  useEffect(() => {
    if (!dialog) return;
    const frame = window.requestAnimationFrame(() => {
      if (dialog.kind === 'prompt') inputRef.current?.focus();
      else cancelButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, dialog]);

  const value = useMemo(() => ({ confirmDialog, promptDialog }), [confirmDialog, promptDialog]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    closeDialog(dialog.kind === 'prompt' ? promptValue : true);
  };

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div className="desktop-dialog-backdrop" role="presentation" onMouseDown={() => closeDialog(null)}>
          <form
            className={`desktop-dialog-card ${dialog.tone === 'danger' ? 'danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-dialog-title"
            aria-describedby={dialog.message ? 'desktop-dialog-message' : undefined}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="desktop-dialog-mark" aria-hidden="true" />
            <div className="desktop-dialog-copy">
              <h3 id="desktop-dialog-title">{dialog.title}</h3>
              {dialog.message ? <p id="desktop-dialog-message">{dialog.message}</p> : null}
            </div>
            {dialog.kind === 'prompt' ? (
              <input
                ref={inputRef}
                className="panel-input desktop-dialog-input"
                value={promptValue}
                placeholder={dialog.placeholder}
                onChange={(event) => setPromptValue(event.target.value)}
              />
            ) : null}
            <div className="desktop-dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="soft-button"
                onClick={() => closeDialog(null)}
              >
                {dialog.cancelLabel}
              </button>
              <button
                type="submit"
                className={dialog.tone === 'danger' ? 'danger-button' : 'primary-button'}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDesktopDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDesktopDialog must be used within DialogProvider');
  }
  return context;
}
