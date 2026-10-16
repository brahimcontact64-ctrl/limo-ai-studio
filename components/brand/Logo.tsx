/**
 * LIMO mark: the lemon from the original approved site (previously the 🍋 emoji),
 * drawn as SVG so it renders identically on every platform.
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    // Solid fills only: a shared gradient id breaks when the defining instance is display:none.
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M8.6 9.4C12.4 5.7 19.5 5.9 23.6 10c4.1 4 4.4 11.1.7 14.9-3.8 3.7-11 3.6-15-.5-4.2-4.1-4.5-11.2-.7-15z" fill="#f6b922" />
      <path d="M9.6 10.3c3.4-3.2 9.4-3 12.9.6 3.3 3.3 3.8 8.9 1.2 12.4-3.4 2.6-9.3 2.2-12.7-1.2-3.4-3.4-4.3-8.6-1.4-11.8z" fill="#ffd43b" />
      <path d="M24.3 24.9c.9.9 2.1 1.3 2.7 1-.1-.7-.6-1.8-1.4-2.6z" fill="#f2a915" />
      <path d="M8.6 9.4c-.9-.9-1.3-2.1-1-2.7.7.1 1.8.6 2.6 1.4z" fill="#e8a014" />
      <path d="M10.2 7.9c1.6-3.6 5.1-5.3 8.6-4.6-1.2 3.3-4.6 5.3-8.6 4.6z" fill="#5db84f" />
      <path d="M10.2 7.9c2.6-1.4 5.3-2.6 8.6-4.6" stroke="#3f8f37" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <ellipse cx="13" cy="12.5" rx="3.2" ry="1.6" transform="rotate(-38 13 12.5)" fill="#fffbd6" opacity="0.7" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo" dir="ltr">
      <LogoMark />
      {!compact && (
        <span className="logo-word">
          <b>LIMO AI</b>
        </span>
      )}
    </span>
  );
}
