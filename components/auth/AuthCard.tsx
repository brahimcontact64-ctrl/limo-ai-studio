import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

export function AuthCard({
  t,
  title,
  lead,
  children,
  footer,
  narrow = false,
}: {
  t: Dictionary;
  title: string;
  lead: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <section className={`auth-card${narrow ? ' narrow' : ''}`}>
      <Link href="/" className="auth-back">
        <span aria-hidden="true" className="flip-rtl">
          ←
        </span>{' '}
        <span dir="ltr">LIMO AI</span>
      </Link>
      <div>
        <LogoMark size={40} />
        <p className="eyebrow" style={{ marginTop: 8 }}>
          {t.auth.customerArea}
        </p>
      </div>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {children}
      {footer}
    </section>
  );
}
