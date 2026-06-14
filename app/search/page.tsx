'use client';

import dynamic from 'next/dynamic';

const DesktopApp = dynamic(() => import('../../src/desktop/DesktopApp'), {
  ssr: false,
});

export default function SearchPage() {
  return <DesktopApp initialView="search" />;
}
