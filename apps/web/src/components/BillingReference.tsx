import {
  IMAGE_POINTS,
  MATERIAL_TIERS,
  MODEL_POINT_COSTS,
  PLANS,
  SUPPORTED_MODELS,
  formatUsd,
} from '@mengyin/core';
import { modelLabel } from '@/lib/models';
import { useApp } from '@/state/AppContext';

/**
 * The billing reference inside the documentation site.
 *
 * Kept separate from the surrounding docs shell so the tables can also be
 * rendered by a future in-app help view without copying the price list.
 */
export function BillingReference() {
  const { t, locale } = useApp();

  return (
    <section className="docs-section" id="docs-billing">
      <h2>{t('docs.billingTitle')}</h2>
      <p className="docs-section__lede">{t('docs.billingBody')}</p>

      <h3 className="docs-subhead">{t('billingDocs.plans')}</h3>
      <div className="docs-table-wrap">
        <table className="table docs-table docs-table--plans">
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
      <p className="docs-note">{t('billingDocs.yearlyNote')}</p>

      <h3 className="docs-subhead">{t('billingDocs.rates')}</h3>
      <p className="docs-note">{t('billingDocs.pointValue')}</p>
      <div className="docs-table-wrap">
        <table className="table docs-table docs-table--rates">
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

      <h3 className="docs-subhead">{t('billingDocs.materialTitle')}</h3>
      <div className="docs-table-wrap">
        <table className="table docs-table docs-table--material">
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
      <p className="docs-note">{t('billingDocs.materialNote')}</p>

      <h3 className="docs-subhead">{t('billingDocs.rules')}</h3>
      <ul className="docs-list">
        <li>{t('billingDocs.ruleFree')}</li>
        <li>{t('billingDocs.ruleReserve')}</li>
        <li>{t('billingDocs.ruleMembership')}</li>
        <li>{t('billingDocs.rulePoints')}</li>
        <li>{t('billingDocs.ruleRender')}</li>
      </ul>

      <h3 className="docs-subhead">{t('billingDocs.faq')}</h3>
      <ul className="docs-list">
        <li>{t('billingDocs.faqDaily')}</li>
        <li>{t('billingDocs.faqCancel')}</li>
        <li>{t('billingDocs.faqRefund')}</li>
      </ul>
    </section>
  );
}
