/**
 * LIMO mark: a citrus cross-section that doubles as a film reel —
 * three segments read as reel windows around a hub.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="14.5" fill="var(--lime)" />
      <circle cx="16" cy="16" r="11.6" fill="var(--bg)" />
      <g fill="var(--lime)">
        <path d="M16 6.4a9.6 9.6 0 0 1 8.3 4.8L17.4 15a1.6 1.6 0 0 0-1.4-.8V6.4Z" />
        <path d="M24.3 20.8A9.6 9.6 0 0 1 16 25.6V17.8a1.6 1.6 0 0 0 1.4-.8l6.9 3.8Z" opacity="0.9" />
        <path d="M7.7 20.8a9.6 9.6 0 0 1 0-9.6l6.9 3.8a1.6 1.6 0 0 0 0 2l-6.9 3.8Z" opacity="0.8" />
      </g>
      <circle cx="16" cy="16" r="1.6" fill="var(--lime)" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo" dir="ltr">
      <LogoMark />
      {!compact && (
        <span className="logo-word">
          <b>LIMO</b>
          <span>AI Studio</span>
        </span>
      )}
    </span>
  );
}
