import { useLayoutEffect, type ReactNode } from 'react';
import { motion, useAnimate, useReducedMotion } from 'framer-motion';

/** 内容切换时重播入场，保留子树身份和滚动容器。 */
export default function MotionPanel({ transitionKey, className, children }: {
  transitionKey: string;
  className?: string;
  children: ReactNode;
}) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const playback = animate(scope.current, {
      opacity: reducedMotion ? 1 : [0.45, 1],
      y: reducedMotion ? 0 : [10, 0],
    }, { duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] });
    return () => playback.stop();
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- 内容标识变化是重播动画的触发条件，不能只在挂载时播放。
  }, [animate, scope, reducedMotion, transitionKey]);

  return <motion.div ref={scope} className={className}>{children}</motion.div>;
}
