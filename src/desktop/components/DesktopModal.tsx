import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}

/** Shared desktop dialog surface for content that needs more than a confirmation. */
export default function DesktopModal({ title, description, className = '', children, actions, onClose }: Props) {
  const titleId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== backdrop.current);
    const inert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current();
      } else if (event.key === 'Tab') {
        const items = Array.from(card.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]'));
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!card.current?.contains(event.target as Node)) closeButton.current?.focus();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      siblings.forEach((element, index) => { element.inert = inert[index]; });
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div ref={backdrop} className="desktop-dialog-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={card} className={`desktop-dialog-card desktop-content-dialog ${className}`} role="dialog"
      aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? `${titleId}-description` : undefined}>
      <div className="desktop-content-dialog-heading"><div className="desktop-dialog-copy">
        <h3 id={titleId}>{title}</h3>{description && <p id={`${titleId}-description`}>{description}</p>}
      </div><button ref={closeButton} type="button" className="soft-button desktop-dialog-close" aria-label="关闭预览" onClick={onClose}>
        <X size={16} aria-hidden="true" /></button></div>
      {children}
      {actions && <div className="desktop-dialog-actions">{actions}</div>}
    </section>
  </div>, document.body);
}
