import { LocaleSwitcher } from '@/components/LocaleSwitcher';

/** Original approved auth layout: a single centred white card on the lavender canvas. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="auth">
      <div className="auth-top">
        <LocaleSwitcher compact />
      </div>
      {children}
    </main>
  );
}
