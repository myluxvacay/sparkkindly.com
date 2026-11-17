import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { site } from '@/lib/config';
import { CONTACT_TOPICS } from '@/lib/contact/submit';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic'; // CONTACT_EMAIL is read at run time, not baked in at build
export const metadata = seo('Contact', 'How to contact SparkKindly: report something wrong on a page, ask a question through the contact form, or reach us as a parent or carer about the Kids world.', '/contact/');

type Props = { searchParams: Promise<{ sent?: string; error?: string }> };

// The published address is shown only when the owner sets CONTACT_EMAIL; nothing here invents one. The form
// below works either way: messages are stored for the owner and, when CONTACT_EMAIL is set, also emailed there.
export default async function Page({ searchParams }: Props) {
  const email = site.contactEmail;
  const { sent, error } = await searchParams;
  return (
    <TrustPage
      crumb="Contact"
      eyebrow="CONTACT"
      title="Let’s keep the conversation thoughtful."
      updated="17 November 2026"
      sections={[
        {
          heading: 'Something on a page is wrong',
          paragraphs: [
            'Every article, quiz and game has a “Report a problem” link near the bottom. It is the quickest way to reach us about a mistake, a broken page, something unsuitable or an accessibility barrier. You choose the kind of problem and may add a message. We do not ask who you are.',
          ],
        },
        {
          heading: 'General questions',
          paragraphs: [
            email ? (
              <>
                You can email <a href={`mailto:${email}`}>{email}</a>, or use the form below. This inbox is read by the site owner. Please do not include a child’s personal details.
              </>
            ) : (
              'A general contact email address has not been published yet. Please use the form below instead: it reaches the site owner, and your email address is kept only so we can reply. Please do not include a child’s personal details.'
            ),
          ],
        },
        ...(site.postalAddress ? [{ heading: 'Postal address', paragraphs: [site.postalAddress] }] : []),
        {
          heading: 'For grown-ups',
          paragraphs: [
            <>
              Please supervise Kids activities and avoid sharing a child’s name, birthday, photo, location or other identifying details. The form below is
              for grown-ups: if you are a child, please ask a parent or carer to send your question for you. More in the{' '}
              <Link href="/privacy/">privacy guide</Link>.
            </>,
          ],
        },
      ]}
    >
      <div className="prose">
        <section>
          <h2>Ask us a question</h2>
          {sent === '1' && (
            <div role="status" id="result" tabIndex={-1} className="takeaway">
              <p>Thanks — we read everything and reply when we can.</p>
            </div>
          )}
          {error === '1' && (
            <div role="alert" id="result" tabIndex={-1} className="grown-ups">
              <p>
                Your message was not sent. Please check your email address, and keep your name under 100 characters and your message under 2000
                characters, in plain text.
              </p>
            </div>
          )}
          <form method="post" action="/contact/submit/" className="quiz-form">
            <p>
              <label htmlFor="name">Your name (optional)</label>
              <br />
              <input id="name" name="name" type="text" maxLength={100} autoComplete="name" style={{ width: '100%', font: 'inherit' }} />
            </p>
            <p>
              <label htmlFor="email">Your email address (so we can reply)</label>
              <br />
              <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" style={{ width: '100%', font: 'inherit' }} />
            </p>
            <p>
              <label htmlFor="topic">What is it about?</label>
              <br />
              <select id="topic" name="topic" required style={{ font: 'inherit' }}>
                {CONTACT_TOPICS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </p>
            <p>
              <label htmlFor="message">Your message (up to 2000 characters)</label>
              <br />
              <textarea id="message" name="message" rows={6} required maxLength={2000} style={{ width: '100%', font: 'inherit' }} />
            </p>
            <p className="muted">
              This form is for grown-ups. If you are a child, please ask a parent or carer to send your question for you. We keep your email address
              only to reply, and we never share it.
            </p>
            {/* Honeypot: hidden from people and assistive technology; a bot that fills it is silently ignored. */}
            <div hidden>
              <label htmlFor="website">Leave this empty</label>
              <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <button type="submit" className="button">
              Send message
            </button>
          </form>
        </section>
      </div>
    </TrustPage>
  );
}
