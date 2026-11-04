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
