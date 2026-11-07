import {
  IMAGE_POINTS,
  MATERIAL_TIERS,
  MODEL_POINT_COSTS,
  PLANS,
  SUPPORTED_MODELS,
  formatUsd,
} from '@mengyin/core';
import { Note, PageHead } from '@/components/ui';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { modelLabel } from '@/lib/models';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useBilling } from '@/state/BillingContext';

/**
 * The billing reference. The point price table deliberately lives here rather
 * than on the plan cards: the cards sell the plan, this page answers "what does
 * a question cost".
 */
export function BillingDocsPage() {
  const { t, locale } = useApp();
  const { me, busy, portal, error } = useBilling();
  const paid = Boolean(me?.plan && me.plan !== 'free');
  const billingError = error === 'popup-blocked' ? t('billing.popupBlocked') : error;

  return (
    <div className="page">
      <PageHead
        title={t('billingDocs.title')}
        lede={t('billingDocs.lede')}
        actions={
          <button type="button" className="text-btn" onClick={() => navigate('/pricing')}>
            ← {t('billingDocs.back')}
          </button>
        }
      />

      <section className="panel billing-doc">
        <div className="panel__head">
          <h2 className="panel__title">{t('billingDocs.plans')}</h2>
        </div>
        <div className="billing-doc__scroll">
          <table className="table billing-doc__table">
            <thead>
              <tr>
                <th>{t('billingDocs.plan')}</th>
                <th>{t('billingDocs.monthly')}</th>
                <th>{t('billingDocs.yearly')}</th>
                <th>{t('billingDocs.questionsPoints')}</th>
                <th>{t('billingDocs.models')}</th>
                <th>{t('billingDocs.images')}</th>
                <th>{t('billingDocs.material')}</th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <span className="table__title">{t(`plan.${plan.id}`)}</span>
                  </td>
                  <td className="table__num">{formatUsd(plan.monthlyCents)}</td>
                  <td className="table__num">
                    {plan.annualCents > 0 ? formatUsd(plan.annualCents) : '—'}
                  </td>
                  <td>
                    {plan.monthlyQuestions > 0
                      ? t('pricing.monthlyQuestions', { n: plan.monthlyQuestions })
                      : t('pricing.monthlyPoints', { n: plan.monthlyPoints })}
                  </td>
                  <td>{plan.models.map(modelLabel).join(' · ')}</td>
                  <td>
                    {plan.imagesPerMonth > 0
                      ? t('pricing.images', { n: plan.imagesPerMonth })
                      : t('pricing.noImages')}
                  </td>
                  <td>{t('pricing.materials', { n: plan.materialChars.toLocaleString(locale) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">{t('billingDocs.yearlyNote')}</p>
      </section>

      <section className="panel billing-doc">
        <div className="panel__head">
          <h2 className="panel__title">{t('billingDocs.rates')}</h2>
          <span className="panel__more">{t('billingDocs.pointValue')}</span>
        </div>
        <div className="billing-doc__scroll">
          <table className="table billing-doc__table billing-doc__table--rates">
            <thead>
              <tr>
                <th>{t('billingDocs.action')}</th>
                <th className="table__num">{t('billingDocs.points')}</th>
                <th>{t('billingDocs.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_MODELS.map((model) => (
                <tr key={model}>
                  <td>{modelLabel(model)}</td>
                  <td className="table__num">{MODEL_POINT_COSTS[model] ?? 0}</td>
                  <td>
                    {model === 'glm-4.7-flash'
                      ? t('billingDocs.freeNote')
                      : model === 'deepseek-flash'
                        ? t('billingDocs.flashNote')
                        : t('billingDocs.proNote')}
                  </td>
                </tr>
              ))}
              <tr>
                <td>{t('billingDocs.image')}</td>
                <td className="table__num">{IMAGE_POINTS}</td>
                <td>{t('billingDocs.imageNote')}</td>
              </tr>
              <tr>
                <td>{t('billingDocs.render')}</td>
                <td className="table__num">0</td>
                <td>{t('billingDocs.renderNote')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel billing-doc">
        <div className="panel__head">
          <h2 className="panel__title">{t('billingDocs.materialTitle')}</h2>
        </div>
        <div className="billing-doc__scroll">
          <table className="table billing-doc__table billing-doc__table--material">
            <thead>
              <tr>
                <th>{t('billingDocs.material')}</th>
                <th className="table__num">{t('billingDocs.points')}</th>
              </tr>
            </thead>
            <tbody>
              {MATERIAL_TIERS.map((tier, index) => {
                const from = index === 0 ? 0 : MATERIAL_TIERS[index - 1]?.maxChars ?? 0;
                return (
                  <tr key={tier.maxChars}>
                    <td>
                      {from.toLocaleString(locale)}–{tier.maxChars.toLocaleString(locale)}
                    </td>
                    <td className="table__num">+{tier.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="footnote">{t('billingDocs.materialNote')}</p>
      </section>

      <section className="panel billing-doc">
        <div className="panel__head">
          <h2 className="panel__title">{t('billingDocs.rules')}</h2>
        </div>
        <ul className="billing-doc__rules">
          <li>{t('billingDocs.ruleFree')}</li>
          <li>{t('billingDocs.ruleReserve')}</li>
          <li>{t('billingDocs.ruleMembership')}</li>
          <li>{t('billingDocs.rulePoints')}</li>
          <li>{t('billingDocs.ruleRender')}</li>
        </ul>
      </section>

      <section className="panel billing-doc">
        <div className="panel__head">
          <h2 className="panel__title">{t('billingDocs.faq')}</h2>
        </div>
        <ul className="billing-doc__rules">
          <li>{t('billingDocs.faqDaily')}</li>
          <li>{t('billingDocs.faqCancel')}</li>
          <li>{t('billingDocs.faqRefund')}</li>
        </ul>
      </section>

      {billingError ? (
        <Note tone="warn">{t('billing.error', { message: billingError })}</Note>
      ) : null}

      <div className="actions-row billing-doc__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => navigate('/pricing')}
        >
          {t('billingDocs.viewPlans')}
        </button>
        {paid ? (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void portal()}>
            {t('billingDocs.manage')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => navigate('/docs/refunds')}
        >
          {t('billingDocs.refundPolicy')}
        </button>
      </div>
      <p className="footnote billing-doc__contact">
        {t('pricing.contact')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </div>
  );
}
