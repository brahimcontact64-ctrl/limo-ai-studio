/** Mailpit helpers for e2e tests against a local Supabase stack (E2E_MAILPIT_URL). */
export const MAILPIT = process.env.E2E_MAILPIT_URL;

interface MailSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
  Created: string;
}

export async function waitForMail(to: string, subject: RegExp, after: number): Promise<{ html: string; subject: string }> {
  if (!MAILPIT) throw new Error('E2E_MAILPIT_URL not set');
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    const list = (await res.json()) as { messages: MailSummary[] };
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === to) && subject.test(m.Subject) && new Date(m.Created).getTime() >= after - 2000);
    if (hit) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { HTML: string; Subject: string };
      return { html: msg.HTML, subject: msg.Subject };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email "${subject}" for ${to}`);
}

export function linkFrom(html: string): string {
  const m = /href="([^"]*token_hash=[^"]*)"/.exec(html);
  if (!m) throw new Error('no token_hash link in email');
  return m[1]!.replace(/&amp;/g, '&');
}
