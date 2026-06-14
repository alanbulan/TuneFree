'use client';

import dynamic from 'next/dynamic';

const DesktopApp = dynamic(() => import('../../../src/desktop/DesktopApp'), {
  ssr: false,
});

export default function DownloadsPage() {
  return <DesktopApp initialView="downloads" />;
}
