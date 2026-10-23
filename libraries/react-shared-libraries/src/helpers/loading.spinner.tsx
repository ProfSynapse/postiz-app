'use client';

// react-loading bundled React16; render with the application's current runtime.
export default function LoadingSpinner({ color = 'currentColor', width = 64, height = 64 }: {
  type?: 'spin';
  color?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <svg role="status" aria-label="Loading" viewBox="0 0 24 24"
      width={width} height={height} style={{ color }}
      className="animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path fill="currentColor" opacity="0.75" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6z" />
    </svg>
  );
}
