import type { AgeGroup, Consent } from './policy';

// Plain wording for an account's age group, shared by /account and the sign-in confirm page.
export function ageWording(ageGroup: AgeGroup | null, consent: Consent): string {
  switch (ageGroup) {
    case 'adult':
      return 'Adult account';
    case 'teen_16_17':
      return 'Age 16 to 17';
    case 'teen_13_15':
      return consent === 'confirmed' ? 'Age 13 to 15' : 'Age 13 to 15, consent pending';
    default:
      return 'Account';
  }
}
