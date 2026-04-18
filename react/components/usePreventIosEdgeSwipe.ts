import { RefObject, useEffect } from 'react';

const EDGE_GUARD_PX = 24;
const HORIZONTAL_TRIGGER_PX = 12;
const VERTICAL_TOLERANCE_PX = 10;

const isIosDevice = (): boolean => {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /iPad|iPhone|iPod/.test(ua);
};

const isStandalonePwa = (): boolean => {
  return window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-ignore iOS Safari standalone flag
    window.navigator.standalone === true;
};

export const usePreventIosEdgeSwipe = (
  containerRef: RefObject<HTMLElement>,
): void => {
  useEffect(() => {
    if (!isIosDevice() || !isStandalonePwa()) return;

    const element = containerRef.current;
    if (!element) return;

    let tracking = false;
    let startX = 0;
    let startY = 0;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      tracking = touch.clientX <= EDGE_GUARD_PX;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);

      if (deltaX > HORIZONTAL_TRIGGER_PX && deltaY < VERTICAL_TOLERANCE_PX) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      tracking = false;
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef]);
};
