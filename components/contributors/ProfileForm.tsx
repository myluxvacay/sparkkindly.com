import Link from 'next/link';
import type { Profile } from '@/lib/contributors/profile';

// Switches the contributor role on (terms required the first time) or edits the profile. Plain form, no JavaScript.
// The link field is offered to adults only (16-17 contributors appear under their display name only).
export default function ProfileForm({ profile, adult }: { profile: Profile | null; adult: boolean }) {
  return (
    <form method="post" action="/me/contribute/enable/" className="admin-form">
      <p>
        <label htmlFor="c-name">Display name (1 to 30 characters, shown on your pieces)</label>
        <input id="c-name" name="display_name" type="text" required maxLength={30} defaultValue={profile?.displayName ?? ''} />
      </p>
      <p>
        <label htmlFor="c-bio">One-line bio (optional, up to 140 characters, no links)</label>
        <input id="c-bio" name="bio" type="text" maxLength={140} defaultValue={profile?.bio ?? ''} />
      </p>
      {adult && (
        <p>
          <label htmlFor="c-link">One link (optional, starts with https://; shown once the site owner approves it)</label>
          <input id="c-link" name="link" type="url" maxLength={200} defaultValue={profile?.link ?? ''} />
        </p>
      )}
      {!profile && (
        <p className="admin-radio">
          <input id="c-terms" name="terms" type="checkbox" required />
          <label htmlFor="c-terms">
            I accept the <Link href="/contributors/terms/">contributor terms</Link>.
          </label>
        </p>
      )}
      <button type="submit" className="button">
        {profile ? 'Save profile' : 'Become a contributor'}
      </button>
    </form>
  );
}
