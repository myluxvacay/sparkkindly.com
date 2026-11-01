import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo('About SparkKindly', 'A little curiosity. A little kindness.', '/about/');

export default function Page() {
  return (
    <TrustPage
      crumb="About SparkKindly"
      eyebrow="ABOUT SPARKKINDLY"
      title="A little curiosity. A little kindness."
      updated="1 November 2026"
      sections={[
        {
          heading: 'Why we are here',
          paragraphs: [
            'SparkKindly is a place to play, learn, connect and grow. Our starting point is simple: a thoughtful question or a small act of attention can be worth making room for.',
          ],
        },
        {
          heading: 'Five worlds to explore',
          paragraphs: [
            'Play offers puzzles with explained answers. Discover follows questions about the world. Together shares fictional stories and everyday ideas for connection. Grow offers optional reflection. Kids is a separate destination for ages 6 to 9, to explore with an adult.',
          ],
        },
        {
          heading: 'What the site is today',
          paragraphs: [
            'Today SparkKindly is a reading and playing site. There are no accounts, comments, scores or public rankings, and nothing to register for. You can answer a quiz or puzzle and see the explanation straight away, and nothing about your answer is kept.',
            'We plan to add optional accounts for teenagers and adults later. Younger visitors (under 13) would not be able to have an account, and 13 to 15 year olds would need a parent or guardian to agree. None of that exists yet, and this page will change before it does.',
          ],
        },
        {
          heading: 'Who writes it, and how it is checked',
          paragraphs: [
            <>
              Much of SparkKindly is written with the help of AI, and new items are checked by software before they are published. Our{' '}
              <Link href="/editorial-policy/">editorial policy</Link> explains what is checked, what is not, and how Kids content is handled.
            </>,
          ],
        },
        {
          heading: 'No pressure to keep up',
          paragraphs: [
            'There are no timers, streaks or ads, and we do not track what you do. Explore what interests you, take an idea off-screen, and leave whenever you choose.',
          ],
        },
        {
          heading: 'Something wrong?',
          paragraphs: [
            <>
              Every article, quiz and game has a “Report a problem” link. You can also read how to <Link href="/contact/">get in touch</Link>.
            </>,
          ],
        },
      ]}
    />
  );
}
