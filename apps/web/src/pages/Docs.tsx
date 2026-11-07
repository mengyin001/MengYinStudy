import { useEffect } from 'react';
import { PageHead } from '@/components/ui';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import '@/styles/docs.css';

/**
 * One place for the instructions and the rules.
 *
 * The legal pages stay standalone (a store reviewer must be able to read them
 * without the app shell), but a learner should not have to know four URLs.
 * This page explains the product, summarises billing and refunds, and links to
 * the authoritative documents.
 */
export function DocsPage({ focus }: { focus?: 'refund' }) {
  const { t } = useApp();

  useEffect(() => {
    document.title = `${t('docs.title')} · MengYin Study`;
  }, [t]);

  useEffect(() => {
    if (!focus) return;
    // The shell has already rendered. A short delay lets the panel lay out
    // before scrolling to it.
    const timer = window.setTimeout(() => {
      document.getElementById(`docs-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [focus]);

  return (
    <div className="page docs-page">
      <PageHead
        title={t('docs.title')}
        lede={t('docs.lede')}
        actions={
          <button type="button" className="text-btn" onClick={() => navigate('/account')}>
            {t('docs.refundCta')}
          </button>
        }
      />

      <section className="panel docs-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.startTitle')}</h2>
        </div>
        <p className="docs-lede">{t('docs.startLede')}</p>
        <ol className="docs-steps">
          <li className="docs-step">
            <span className="docs-step__num">01</span>
            <h3>{t('docs.step1Title')}</h3>
            <p>{t('docs.step1Body')}</p>
            <button type="button" className="text-btn" onClick={() => navigate('/plaza')}>
              {t('docs.step1Action')}
            </button>
          </li>
          <li className="docs-step">
            <span className="docs-step__num">02</span>
            <h3>{t('docs.step2Title')}</h3>
            <p>{t('docs.step2Body')}</p>
            <button type="button" className="text-btn" onClick={() => navigate('/generate')}>
              {t('docs.step2Action')}
            </button>
          </li>
          <li className="docs-step">
            <span className="docs-step__num">03</span>
            <h3>{t('docs.step3Title')}</h3>
            <p>{t('docs.step3Body')}</p>
            <button type="button" className="text-btn" onClick={() => navigate('/practice')}>
              {t('docs.step3Action')}
            </button>
          </li>
          <li className="docs-step">
            <span className="docs-step__num">04</span>
            <h3>{t('docs.step4Title')}</h3>
            <p>{t('docs.step4Body')}</p>
            <button type="button" className="text-btn" onClick={() => navigate('/stats')}>
              {t('docs.step4Action')}
            </button>
          </li>
        </ol>
      </section>

      <section className="panel docs-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.aiTitle')}</h2>
        </div>
        <p className="docs-lede">{t('docs.aiBody')}</p>
      </section>

      <section className="panel docs-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.billingTitle')}</h2>
          <button type="button" className="panel__more" onClick={() => navigate('/docs/billing')}>
            {t('docs.billingCta')} →
          </button>
        </div>
        <p className="docs-lede">{t('docs.billingBody')}</p>
      </section>

      <section className="panel docs-panel docs-panel--refund" id="docs-refund">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.refundTitle')}</h2>
          <button type="button" className="panel__more" onClick={() => navigate('/account')}>
            {t('docs.refundCta')} →
          </button>
        </div>
        <p className="docs-lede">{t('docs.refundIntro')}</p>

        <div className="docs-formula">
          <h3>{t('docs.refundFormulaTitle')}</h3>
          <p>{t('docs.refundMonthly')}</p>
          <p>{t('docs.refundAnnual')}</p>
          <p className="docs-formula__full">{t('docs.refundFull')}</p>
        </div>

        <ul className="docs-list">
          <li>{t('docs.refundBullet1')}</li>
          <li>{t('docs.refundBullet2')}</li>
          <li>{t('docs.refundBullet3')}</li>
          <li>{t('docs.refundBullet4')}</li>
          <li>{t('docs.refundBullet5')}</li>
        </ul>

        <p className="docs-contact">
          {t('docs.contactBody')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>

      <section className="panel docs-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.policiesTitle')}</h2>
        </div>
        <p className="docs-lede">{t('docs.policiesLede')}</p>
        <div className="docs-cards">
          <button type="button" className="docs-card" onClick={() => navigate('/docs/billing')}>
            <span className="docs-card__label">{t('docs.policyBillingTitle')}</span>
            <span className="docs-card__body">{t('docs.policyBillingBody')}</span>
          </button>
          <button type="button" className="docs-card" onClick={() => navigate('/docs/refunds')}>
            <span className="docs-card__label">{t('docs.policyRefundTitle')}</span>
            <span className="docs-card__body">{t('docs.policyRefundBody')}</span>
          </button>
          <button type="button" className="docs-card" onClick={() => navigate('/privacy')}>
            <span className="docs-card__label">{t('docs.policyPrivacyTitle')}</span>
            <span className="docs-card__body">{t('docs.policyPrivacyBody')}</span>
          </button>
          <button type="button" className="docs-card" onClick={() => navigate('/terms')}>
            <span className="docs-card__label">{t('docs.policyTermsTitle')}</span>
            <span className="docs-card__body">{t('docs.policyTermsBody')}</span>
          </button>
        </div>
      </section>

      <section className="panel docs-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('docs.contactTitle')}</h2>
        </div>
        <p className="docs-lede">
          {t('docs.contactBody')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </div>
  );
}
