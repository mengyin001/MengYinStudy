import { describe, expect, it } from 'vitest';
import { APP_DISPLAY_NAME, LANDING } from './copy';

describe('public homepage copy', () => {
  const all = JSON.stringify(LANDING);

  it('uses the exact OAuth application name', () => {
    expect(APP_DISPLAY_NAME).toBe('MengYin Study');
    expect(all.toLowerCase()).not.toContain('google sign-in is optional');
    expect(all).toContain('MengYin Study');
  });

  it('states the purpose without requiring an account', () => {
    expect(LANDING.heroLede.en).toContain('revision and practice app');
    expect(LANDING.heroBody.en).toContain('No ads');
    expect(LANDING.ctaNote.en.toLowerCase()).not.toContain('google');
    expect(LANDING.features.items.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the Google limited-use and NCII disclosures', () => {
    expect(LANDING.google.body.en.toLowerCase()).not.toContain('optional');
    expect(LANDING.google.limitedUse.en).toContain('Limited Use');
    expect(LANDING.google.limitedUse.en).toContain('Google API Services User Data Policy');
    expect(LANDING.google.apiOnlyForSignIn.en).toContain('only for sign-in');
    expect(LANDING.ai.policy.en).toContain('AI-generated non-consensual intimate imagery (AI NCII)');
    expect(LANDING.ai.policy.en).toContain('does not use Google APIs');
  });
});
