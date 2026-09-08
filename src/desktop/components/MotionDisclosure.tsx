import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export default function MotionDisclosure({ label, className = '', children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`settings-details ${className}`}>
      <button type="button" className="settings-disclosure-trigger" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((value) => !value)}>
        {label}<motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}><ChevronDown size={15} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div id={id} className="disclosure-content" role="region" aria-label={label}
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>{children}</motion.div>}
      </AnimatePresence>
    </section>
  );
}
