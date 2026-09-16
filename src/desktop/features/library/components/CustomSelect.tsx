import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import MotionChoice from '../../../components/MotionChoice';
import Tooltip from '../../../components/Tooltip';

interface CustomSelectProps {
  id?: string;
  value: string;
  options: readonly { label: string; value: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function CustomSelect({ id, value, options, onChange, disabled }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuBounds, setMenuBounds] = useState({ upwards: false, maxHeight: 320 });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const indicatorId = useId();
  const listboxId = `${indicatorId}-options`;

  const selectedOption = options.find((o) => o.value === value) || options[0];
  const openMenu = () => {
    const bounds = triggerRef.current!.getBoundingClientRect();
    const viewport = triggerRef.current!.closest('.view-scroll')?.getBoundingClientRect();
    const below = (viewport?.bottom ?? window.innerHeight) - bounds.bottom - 12;
    const above = bounds.top - (viewport?.top ?? 0) - 12;
    const upwards = below < Math.min(320, options.length * 40 + 12) && above > below;
    setMenuBounds({ upwards, maxHeight: Math.max(0, Math.min(320, upwards ? above : below)) });
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const option = containerRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)')
      || containerRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="custom-select-container" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
        event.stopPropagation();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !disabled) {
        event.preventDefault();
        if (!isOpen) { openMenu(); return; }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <Tooltip label={selectedOption.label}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        onClick={() => isOpen ? setIsOpen(false) : openMenu()}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
      >
        <span>{selectedOption.label}</span>
        <svg
          className={`custom-select-arrow ${isOpen ? 'is-open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      </Tooltip>

      <AnimatePresence>
      {isOpen && (
        <motion.div className={`custom-select-options${menuBounds.upwards ? ' opens-upwards' : ''}`} role="listbox"
          id={listboxId} aria-labelledby={id} style={{ maxHeight: menuBounds.maxHeight }}
          initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
          {options.map((option) => (
            <MotionChoice
              key={option.value}
              type="button"
              role="option"
              tabIndex={-1}
              disabled={option.disabled}
              aria-selected={option.value === value}
              aria-pressed={undefined} selected={option.value === value} indicatorId={indicatorId}
              className={`custom-select-option ${option.value === value ? 'is-selected' : ''}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {option.label}
            </MotionChoice>
          ))}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
