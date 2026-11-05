import { notFound } from 'next/navigation';
import TrustPage from '@/components/TrustPage';
import { commentsEnabled } from '@/lib/config';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo('Community guidelines', 'Be kind. Keep it relevant.', '/community/guidelines/');

// Linked from every comment form (plan 7A, spec Project 7). With comments off it does not exist.
export default function Page() {
  if (!commentsEnabled()) notFound();
  return (
    <TrustPage
      crumb="Community guidelines"
      eyebrow="COMMUNITY GUIDELINES"
      title="Be kind. Keep it relevant."
      updated="5 November 2026"
      sections={[
        {
          heading: 'Who can comment',
          paragraphs: [
            'Signed-in members aged 16 and over can comment on items outside the Kids world. Child profiles never see or post comments.',
          ],
        },
        {
          heading: 'Our guidelines',
          paragraphs: [
            'Be kind. Disagree with ideas, never attack people.',
            'Keep personal information private: no names, addresses, phone numbers, schools or contact details, yours or anyone else’s.',
            'No advertising or links to sell something.',
            'Keep it relevant to the item you are commenting on.',
          ],
        },
        {
          heading: 'How comments are checked',
          paragraphs: [
            'Every comment passes automatic checks for length, blocked words, repeats and links. A new member’s comments wait for review before they appear. After several approved comments, a member’s comments appear straight away and may still be reviewed afterwards.',
            'Comments that break these guidelines are removed, and an account that keeps breaking them can lose the ability to comment. You can edit a comment for 15 minutes after posting and delete it at any time.',
          ],
        },
      ]}
    />
  );
}
