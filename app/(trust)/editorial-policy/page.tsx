import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo('Editorial policy', 'Care in every question.', '/editorial-policy/');

export default function Page() {
  return (
    <TrustPage
      crumb="Editorial policy"
      eyebrow="EDITORIAL POLICY"
      title="Care in every question."
      updated="1 November 2026"
      sections={[
        {
          heading: 'AI-assisted content',
          paragraphs: [
            'SparkKindly’s articles, quizzes and games are written with the help of AI. Where a piece is fiction it is labelled as fiction. AI can be wrong, so we do not treat anything it writes as established fact.',
          ],
        },
        {
          heading: 'What happens before an item is published',
          paragraphs: [
            'Every new item is run through automatic checks on our server: it must have the right structure, must not repeat something we published recently, must not contain blocked words or topics, must give a worked explanation for its answer, and, for pieces that make factual claims, must list sources whose links work. An item that fails a check is not published.',
            'These checks are software, not a person. An item that passes them can be published without a person reading it first. The initial collection of ten articles and fourteen quizzes was read and approved by the site owner on 19 October 2026. That approval is the owner’s own judgement. It is not a specialist, legal or professional fact-check.',
          ],
        },
        {
          heading: 'Kids content',
          paragraphs: [
            'Anything for the Kids world waits for the site owner’s approval before it can appear. It is never published automatically. Kids activities state an age range, adult supervision, materials and safe steps.',
          ],
        },
        {
          heading: 'Sources and accuracy',
          paragraphs: [
            'Where a piece rests on facts, we list the sources it draws on. A listed source is not a guarantee: a link shows where a claim came from, not that it has been independently verified. Quiz answers carry an explanation so you can check the reasoning yourself.',
          ],
        },
        {
          heading: 'Modest claims',
          paragraphs: [
            'Reflection and connection pieces offer everyday ideas. They are not medical, financial, legal or therapeutic advice, and we do not publish content that gives it.',
          ],
        },
        {
          heading: 'Corrections',
          paragraphs: [
            <>
              If something is wrong, use the “Report a problem” link on the page. Reports are stored for the site owner to read. When an item is corrected we note
              the correction on the item. For other questions see <Link href="/contact/">Contact</Link>.
            </>,
          ],
        },
      ]}
    />
  );
}
