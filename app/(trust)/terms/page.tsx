import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo('Terms of use', 'Plain terms for using SparkKindly.', '/terms/');

// Draft written by the builder, not by a lawyer. Governing law, liability limits and a company name are owner/legal
// decisions and are deliberately absent (see docs/CUTOVER.md, "Owner decisions").
export default function Page() {
  return (
    <TrustPage
      crumb="Terms of use"
      eyebrow="TERMS OF USE"
      title="Plain terms for using SparkKindly."
      updated="1 November 2026"
      sections={[
        {
          heading: 'Using the site',
          paragraphs: [
            'You may read, play and share links to SparkKindly for your own personal, non-commercial use. Please do not try to disrupt the site, overload it, or copy it in bulk.',
          ],
        },
        {
          heading: 'Information, not advice',
          paragraphs: [
            'Articles, quizzes, games and ideas are offered for learning, enjoyment and reflection. They are not medical, legal, financial or professional advice. Some content is written with the help of AI and can contain mistakes, even after our checks; see the editorial policy.',
          ],
        },
        {
          heading: 'Kids',
          paragraphs: [
            'Kids activities are for children aged 6 to 9 with a responsible adult, who is responsible for their supervision, for following the safety notes on each activity and for what a child shares.',
          ],
        },
        {
          heading: 'Our content and the brand',
          paragraphs: [
            'The text, images, name, logo and badge on SparkKindly belong to SparkKindly or are used with permission, and are not licensed for reuse beyond fair personal sharing. Links and quotations of sources belong to their own authors.',
          ],
        },
        {
          heading: 'Problem reports',
          paragraphs: [
            'If you send a problem report, you allow us to read it and act on it. Please keep it to the page it concerns and leave out personal details.',
          ],
        },
        {
          heading: 'No accounts, comments or submissions yet',
          paragraphs: [
            'These terms cover what exists today. Before accounts, comments or contributions are offered, these terms and our privacy notice will be extended and published first.',
          ],
        },
        {
          heading: 'Changes and questions',
          paragraphs: [
            <>
              We may update these terms; the date at the top shows the latest change. The site is provided as it is, without promises that it will
              always be available or error-free. Questions: <Link href="/contact/">Contact</Link>.
            </>,
          ],
        },
      ]}
    />
  );
}
