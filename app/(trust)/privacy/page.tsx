import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo('Privacy and the grown-up guide', 'What SparkKindly collects and what it does not: your answers, hosting and technical logs, Kids and shared devices, and other websites we link to.', '/privacy/');

export default function Page() {
  return (
    <TrustPage
      crumb="Privacy and the grown-up guide"
      eyebrow="PRIVACY AND THE GROWN-UP GUIDE"
      title="Curiosity without a profile."
      updated="17 November 2026"
      sections={[
        {
          heading: 'What we collect today',
          paragraphs: [
            'SparkKindly has no accounts, sign-in, comments, uploads, advertising, local-storage identifiers, fingerprinting or location features. Fonts, images and the site’s own scripts all come from SparkKindly itself. The one outside service we use is Microsoft Clarity, described in the next paragraph.',
            'We use Microsoft Clarity to understand how visitors use the site: which pages are read, and where people click, scroll and stop, shown to us as heatmaps and recorded browsing sessions. Clarity is run by Microsoft, which processes that information on our behalf, and it sets cookies (called _clck and _clsk) to tell one visit from another. The words on a page are hidden in Clarity’s recordings by default, and we do not send Clarity anything you type or your answers. Microsoft’s own privacy statement describes what Microsoft does with the information Clarity collects.',
            'A few articles carry a video from YouTube. Nothing is requested from YouTube until you press Play: the preview picture comes from SparkKindly. When you press Play, the video loads from YouTube (a Google service), which may set its own cookies. Kids pages never carry a video.',
            'A visitor can send us two things. A “Report a problem” form on each page stores the kind of problem, the message you type (up to 1000 characters, optional), the page it is about and the time. It does not store your name, email address or any account, and we ask you not to type personal details into it.',
            'The contact form is different, because its point is a reply: it stores your name (only if you give it), your email address, the topic you choose, your message (up to 2000 characters) and the time. The site owner reads it and uses your address only to reply; we never share it or use it for marketing.',
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
            'The site runs on a server managed by the site owner at Hostinger, behind the Caddy web server. The server and its software necessarily handle connection details such as your IP address, and may write them to technical logs. To stop abuse, the problem and contact forms limit how many messages one connection can send; those counts are held in memory only and are cleared when the site restarts.',
            'We have not yet independently reviewed how long the host and server keep logs, or which services the host uses to run its systems. We do not claim those details are final.',
          ],
        },
        {
          heading: 'Kids and shared devices',
          paragraphs: [
            'Kids activities are meant for ages 6 to 9 with an adult beside them. The Kids pages follow the same rules as the rest of the site: no accounts and no stored answers. The same Microsoft Clarity measurement described above runs on Kids pages too; it records how a page is used, and the words on the page are hidden in its recordings by default. Please do not type a child’s name, birthday, photo, location or other identifying detail into the problem form, the contact form or anywhere else. The contact form is for grown-ups; a child should ask a parent or carer to send their question.',
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
