import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { site } from '@/lib/config';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic'; // CONTACT_EMAIL is read at run time, not baked in at build
export const metadata =seo('Contact', 'Let’s keep the conversation thoughtful.', '/contact/');

// The address is shown only when the owner sets CONTACT_EMAIL; nothing here invents one.
export default function Page() {
  const email = site.contactEmail;
  return (
    <TrustPage
      crumb="Contact"
      eyebrow="CONTACT"
      title="Let’s keep the conversation thoughtful."
      updated="1 November 2026"
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
                You can email <a href={`mailto:${email}`}>{email}</a>. This inbox is read by the site owner. Please do not include a child’s personal details.
              </>
            ) : (
              'A general contact address has not been published yet. We will not guess one or ask you to send personal details through a form, so until it is listed here, please use the problem report on a page.'
            ),
          ],
        },
        {
          heading: 'For grown-ups',
          paragraphs: [
            <>
              Please supervise Kids activities and avoid sharing a child’s name, birthday, photo, location or other identifying details. The site has
              no form for children’s messages. More in the <Link href="/privacy/">privacy guide</Link>.
            </>,
          ],
        },
      ]}
    />
  );
}
