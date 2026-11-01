import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { site } from '@/lib/config';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic'; // CONTACT_EMAIL is read at run time, not baked in at build
export const metadata =seo('Accessibility', 'A place with room for you.', '/accessibility/');

export default function Page() {
  return (
    <TrustPage
      crumb="Accessibility"
      eyebrow="ACCESSIBILITY"
      title="A place with room for you."
      updated="1 November 2026"
      sections={[
        {
          heading: 'Our target',
          paragraphs: [
            'SparkKindly is built to meet WCAG 2.2 level AA. That is a target, not a claim that every page conforms. Automatic tests and our own keyboard, zoom and narrow-screen checks cover the pages listed below; a check with a real screen reader and a review by an outside specialist have not yet been done.',
          ],
        },
        {
          heading: 'What we have built in',
          paragraphs: [
            'A skip link leads to the main content. Everything works with a keyboard, and the place you are is always visible. Quizzes and games are plain forms that work without a mouse and without JavaScript: you choose an answer, press the button, and the page tells you the result and moves your focus to it. Pages reflow to a 320 pixel wide screen without sideways scrolling, and text can be enlarged with your browser’s zoom.',
            'Nothing is timed, nothing plays sound or video automatically, and nothing flashes. Decorative movement is switched off if your device asks for reduced motion.',
          ],
        },
        {
          heading: 'Images and media',
          paragraphs: [
            'Photographs have descriptions. The generated pictures that sit with articles are decoration and are hidden from screen readers. If we publish video, it will have captions and a transcript before it goes live; there is no video on the site today.',
          ],
        },
        {
          heading: 'Known limits',
          paragraphs: [
            'Some text, such as small labels in cards, is smaller than we would like and relies on browser zoom. Source links go to other websites whose accessibility we do not control.',
          ],
        },
        {
          heading: 'Telling us about a barrier',
          paragraphs: [
            <>
              Use the “Report a problem” link on the page where you met the barrier and choose “Something is broken”.{' '}
              {site.contactEmail ? (
                <>
                  You can also email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
                </>
              ) : (
                <>
                  A general email address is not yet published; see <Link href="/contact/">Contact</Link>.
                </>
              )}
            </>,
          ],
        },
      ]}
    />
  );
}
