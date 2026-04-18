import { useEffect, useState } from 'react';

const detectIosStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent || navigator.vendor || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;

  return window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-ignore iOS Safari standalone flag
    window.navigator.standalone === true;
};

export const useIsIosStandalone = (): boolean => {
  const [isIosStandalone, setIsIosStandalone] = useState(false);

  useEffect(() => {
    setIsIosStandalone(detectIosStandalone());
  }, []);

  return isIosStandalone;
};
