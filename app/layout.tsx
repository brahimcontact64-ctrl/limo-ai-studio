import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/layout.css';
import '../styles/studio.css';
import '../styles/images.css';
import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import { ToastProvider } from '@/components/ui/Toast';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: t.meta.title, template: `%s · ${t.meta.title}` },
    description: t.meta.description,
    applicationName: t.meta.title,
    icons: { icon: '/icon.svg' },
  };
}

export const viewport: Viewport = {
  themeColor: '#f7f7fb',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir, t } = await getI18n();
  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${arabic.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          {t.common.skipToContent}
        </a>
        <I18nProvider locale={locale} dictionary={t}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
