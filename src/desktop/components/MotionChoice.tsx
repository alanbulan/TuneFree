import type { ComponentProps, ReactNode } from 'react';
import { motion } from 'framer-motion';

/** 同组的选中背景共用 layoutId，在选项之间连续移动。 */
export default function MotionChoice({ selected, indicatorId, children, className = '', ...props }: {
  selected: boolean;
  indicatorId: string;
  children: ReactNode;
} & ComponentProps<typeof motion.button>) {
  return (
    <motion.button type="button" aria-pressed={selected} {...props}
      className={`${className} motion-choice${selected ? ' active' : ''}`}
      whileTap={{ scale: 0.97 }}>
      {selected && <motion.span className="selection-indicator" aria-hidden="true"
        layoutId={indicatorId} transition={{ type: 'spring', stiffness: 440, damping: 36 }} />}
      {children}
    </motion.button>
  );
}
