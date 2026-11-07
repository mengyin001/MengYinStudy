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

  it('mentions paid plans, monthly points and the pricing page', () => {
    expect(LANDING.ctaNote.en).toContain('Paid plans');
    expect(LANDING.ctaNote.en).toContain('cancel any time');
    expect(LANDING.nav.pricing.en).toBe('Pricing');
    expect(LANDING.footer.pricing.en).toBe('Pricing');
    expect(LANDING.ctaPricing.en).toBe('See plans and points');
    expect(LANDING.features.items[2]?.body.en).toContain('200 questions a month');
  });

  it('labels AI-generated output and asks learners to verify it', () => {
    const points = LANDING.ai.points.map((point) => point.en).join(' ');
    expect(LANDING.ai.body.en).toContain('AI-generated output is labelled');
    expect(points).toContain('AI-generated questions, answers, explanations and images are labelled');
    expect(points).toContain('Verify them against independent sources');
    expect(points).toContain('Do not use AI output as the only source');
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
