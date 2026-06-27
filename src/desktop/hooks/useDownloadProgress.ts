import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Subscribes to the `download-progress` Tauri event and exposes the
 * latest progress value.  Returns `null` when no download is in flight.
 */
export function useDownloadProgress(): number | null {
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<{ url: string; progress: number }>('download-progress', (event) => {
      if (cancelled) return;
      setProgress(event.payload.progress);
    }).then((unlistenFn) => {
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return progress;
}
