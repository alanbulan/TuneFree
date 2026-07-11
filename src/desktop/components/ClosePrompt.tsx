import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ClosePromptProps {
  open: boolean;
  rememberChoice: boolean;
  onRememberChoiceChange: (remember: boolean) => void;
  onResolve: (action: 'tray' | 'exit' | 'cancel') => void;
}

export default function ClosePrompt({
  open, rememberChoice, onRememberChoiceChange, onResolve,
}: ClosePromptProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !promptRef.current) return;
      const focusable = promptRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if ((event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }} role="presentation" onMouseDown={() => onResolve('cancel')}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '24px', background: 'rgba(15, 23, 42, 0.18)',
            backdropFilter: 'blur(10px)' }}>
          <motion.section ref={promptRef} role="dialog" aria-modal="true" aria-labelledby="close-prompt-title"
            initial={{ scale: 0.92, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            onMouseDown={(event) => event.stopPropagation()} className="glass-panel"
            style={{ width: 'min(420px, 100%)', borderRadius: '24px', padding: '22px',
              background: 'var(--ios-card)', color: 'var(--text)', boxShadow: '0 28px 80px rgba(0, 0, 0, 0.22)',
              border: '1px solid var(--line)' }}>
            <h3 id="close-prompt-title" style={{ margin: 0, fontSize: '18px', fontWeight: 900 }}>关闭 TuneFree？</h3>
            <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              可以让 TuneFree 留在系统托盘继续播放，也可以彻底退出应用。彻底退出时桌面歌词会一起关闭。
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px',
              fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberChoice}
                onChange={(event) => onRememberChoiceChange(event.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }} />
              记住我的选择
            </label>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', flexWrap: 'wrap' }}>
              <button ref={cancelRef} type="button" className="soft-button" onClick={() => onResolve('cancel')}>取消</button>
              <button type="button" className="soft-button" onClick={() => onResolve('tray')}>最小化到托盘</button>
              <button type="button" className="primary-button" onClick={() => onResolve('exit')}>退出应用</button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
