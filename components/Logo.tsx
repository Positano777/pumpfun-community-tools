export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#150F10" stroke="#302C2D" />
      <path d="M10 40c9-15 23-23 43-23-6 4-10 9-12 15 5-1 9 0 12 2-9 1-16 6-20 13-4-5-12-7-23-7z" fill="#D63B3B" />
      <circle cx="42" cy="27" r="2.8" fill="#050303" />
    </svg>
  );
}
