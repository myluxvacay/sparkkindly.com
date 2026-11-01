import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo('Privacy and the grown-up guide', 'Curiosity without a profile.', '/privacy/');

export default function Page() {
  return (
    <TrustPage
      crumb="Privacy and the grown-up guide"
      eyebrow="PRIVACY AND THE GROWN-UP GUIDE"
      title="Curiosity without a profile."
      updated="1 November 2026"
      sections={[
        {
          heading: 'What we collect today',
          paragraphs: [
            'SparkKindly has no accounts, sign-in, comments, uploads, analytics, advertising, tracking cookies, local-storage identifiers, fingerprinting or location features. Your browser makes no requests to other companies’ servers while you read or play: fonts, images and scripts all come from SparkKindly itself.',
            'The only thing a visitor can send us is a “Report a problem” form. It stores the kind of problem, the message you type (up to 1000 characters, optional), the page it is about and the time. It does not store your name, email address or any account, and we ask you not to type personal details into it.',
          ],
        },
        {
          heading: 'Your answers',
          paragraphs: [
            'When you check an answer to a quiz or puzzle, your answer is sent to our server inside the page address so the server can check it and show the explanation. Our application does not save it, and nothing links it to you. Like any web request, the address can appear in the web server’s ordinary technical logs; see the next section.',
          ],
        },
        {
          heading: 'Hosting and technical logs',
          paragraphs: [
            'The site runs on a server managed by the site owner at Hostinger, behind the Caddy web server. The server and its software necessarily handle connection details such as your IP address, and may write them to technical logs. To stop abuse, the problem form limits how many reports one connection can send; that count is held in memory only and is cleared when the site restarts.',
            'We have not yet independently reviewed how long the host and server keep logs, or which services the host uses to run its systems. We do not claim those details are final.',
          ],
        },
        {
          heading: 'Kids and shared devices',
          paragraphs: [
            'Kids activities are meant for ages 6 to 9 with an adult beside them. The Kids pages follow the same rules as the rest of the site: no accounts, no stored answers, no tracking and no outside requests. Please do not type a child’s name, birthday, photo, location or other identifying detail into the problem form or anywhere else.',
          ],
        },
        {
          heading: 'Accounts are not available yet',
          paragraphs: [
            'We plan to offer optional accounts later. The plan is that people under 13 cannot have an account, that 13 to 15 year olds need a parent or guardian’s confirmation, and that a parent can withdraw it. None of this is built, and this notice will be rewritten, and independently reviewed, before any account is offered.',
          ],
        },
        {
          heading: 'Other websites',
          paragraphs: [
            'Source links lead to other websites with their own privacy practices. Reading our pages does not load them; only clicking a link does.',
          ],
        },
        {
          heading: 'What this notice is not',
          paragraphs: [
            <>
              This describes how the site works now. It is not a compliance certification. A review of child privacy for the countries we serve by a
              qualified person has not yet happened, and the owner has asked for it. Questions or requests about information we may hold:{' '}
              <Link href="/contact/">Contact</Link>.
            </>,
          ],
        },
      ]}
    />
  );
}
