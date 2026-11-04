import { consentPending, type AgeGroup, type Consent } from './policy';

// Plain wording for an account's age group, shared by /account and the sign-in confirm page.
export function ageWording(ageGroup: AgeGroup | null, consent: Consent): string {
  switch (ageGroup) {
    case 'adult':
      return 'Adult account';
    case 'teen_16_17':
      return 'Age 16 to 17';
    case 'teen_13_15':
      return consentPending(ageGroup, consent) ? 'Age 13 to 15, consent pending' : 'Age 13 to 15';
    default:
      return 'Account';
  }
}

// The day parental consent was recorded, as /account shows it ("3 November 2026", UTC).
export const consentDay = (at: Date): string =>
  at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// A parent or guardian address shown on the link confirm page: first character, a fixed run of bullets, the domain.
// Anyone holding the link sees it, so it must not hand out a third party's full address.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : '•••';
}
