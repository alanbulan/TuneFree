import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import MotionChoice from '../../../components/MotionChoice';

interface CustomSelectProps {
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}

export default function CustomSelect({ value, options, onChange }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorId = useId();

  const selectedOption = options.find((o) => o.value === value) || options[0];

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
    <div ref={containerRef} className="custom-select-container" onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        containerRef.current?.querySelector('button')?.focus();
        event.stopPropagation();
      }
    }}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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

      <AnimatePresence>
      {isOpen && (
        <motion.div className="custom-select-options" role="listbox"
          initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
          {options.map((option) => (
            <MotionChoice
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-pressed={undefined} selected={option.value === value} indicatorId={indicatorId}
              className={`custom-select-option ${option.value === value ? 'is-selected' : ''}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
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
