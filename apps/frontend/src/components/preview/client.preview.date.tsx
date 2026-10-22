'use client';

import dynamic from 'next/dynamic';

// Keep local timezone rendering in the browser. Next 15 requires ssr:false
// dynamic imports to live inside a Client Component.
export const ClientPreviewDate = dynamic(
  () => import('./render.preview.date').then((mod) => mod.RenderPreviewDate),
  { ssr: false }
);
