import { useEffect, useState } from 'react';
import { annualMonthlyCents, formatUsd, type Plan } from '@mengyin/core';
import { Icon } from '@/components/Icons';
import { Note, PageHead, Seg } from '@/components/ui';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { formatLongDate } from '@/lib/format';
import { modelLabel } from '@/lib/models';
import { navigate, useRoute } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useBilling } from '@/state/BillingContext';

type Interval = 'month' | 'year';

export function PricingPage() {
  const { t, locale, actions } = useApp();
  const { state: auth } = useAuth();
  const {
    config,
    me,
    plan,
    points,
    questionsLimit,
    questionsRemaining,
    enforced,
    busy,
    error,
    checkout,
    portal,
    refresh,
  } = useBilling();
  const route = useRoute();
  const [interval, setInterval] = useState<Interval>('month');
  const [localError, setLocalError] = useState<string | null>(null);

  const plans = config?.plans ?? [];
  const stripeReady = config?.stripeReady ?? false;
  const current = plan.id;

  // Returning from Stripe: confirm the payment, refresh the balance and drop
  // the query so a reload does not repeat the toast.
  useEffect(() => {
    const status = route.query.get('checkout');
    if (!status) return;
    if (status === 'success') {
      actions.notify('success', t('billing.checkoutSuccess'));
      void refresh();
    } else {
      actions.notify('info', t('billing.checkoutCancelled'));
    }
    navigate('/pricing', { replace: true });
    // Run once for the redirect that opened this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodEnd = me?.periodEnd ? Date.parse(me.periodEnd) : Number.NaN;

  const priceOf = (plan: Plan): string =>
    interval === 'year' ? formatUsd(plan.annualCents) : formatUsd(plan.monthlyCents);
  const billingError = error === 'popup-blocked' ? t('billing.popupBlocked') : error;

  const onChoose = async (plan: Plan) => {
    setLocalError(null);
    if (!auth.user) {
      navigate('/login?next=/pricing');
      return;
    }
    if (plan.id === 'free') return;
    if (current === plan.id) {
      await portal();
      return;
    }
    // A second Checkout would open a second Stripe subscription while the
    // first keeps charging. Existing subscribers change plans in the portal.
    if (current !== 'free' && me?.membershipActive) {
      await portal();
      return;
    }
    await checkout(plan.id, interval);
  };

  const actionLabel = (plan: Plan): string => {
    if (plan.id === 'free') {
      return current === 'free' ? t('billing.current') : t('pricing.freeIncluded');
    }
    if (!auth.user) return t('billing.signIn');
    if (current === plan.id) return t('billing.manage');
    if (current !== 'free' && me?.membershipActive) return t('pricing.changePlan');
    return t('pricing.subscribe', { plan: t(`plan.${plan.id}`) });
  };

  return (
    <div className="page">
      <PageHead
        title={t('pricing.title')}
        lede={t('pricing.lede')}
        actions={
          <>
            <Seg
              value={interval}
              onChange={setInterval}
              label={t('pricing.title')}
              options={[
                { value: 'month', label: t('pricing.monthly') },
                { value: 'year', label: t('pricing.annual') },
              ]}
            />
            <button
              type="button"
              className="text-btn"
              onClick={() => navigate('/docs/billing')}
            >
              {t('billingDocs.title')}
            </button>
            <button type="button" className="text-btn" onClick={() => navigate('/docs')}>
              {t('nav.docs')}
            </button>
          </>
        }
      />

      {!config ? (
        <Note>{t('common.loading')}</Note>
      ) : (
        <>
          {enforced ? null : <Note>{t('billing.unenforced')}</Note>}
          {stripeReady ? null : <Note tone="warn">{t('billing.notReady')}</Note>}

          {auth.user ? (
            <p className="pricing-balance">
              <span className="badge badge--official">{t(`plan.${current}`)}</span>
              {current === 'free' ? (
                <strong>
                  {t('gen.freeRemaining', {
                    n: questionsRemaining ?? questionsLimit,
                    limit: questionsLimit,
                  })}
                </strong>
              ) : (
                <strong>{t('billing.points', { n: points })}</strong>
              )}
              {Number.isFinite(periodEnd) && current !== 'free' ? (
                <span className="footnote">
                  {me?.cancelAtPeriodEnd
                    ? t('billing.ends', { date: formatLongDate(periodEnd, locale) })
                    : t('billing.renews', { date: formatLongDate(periodEnd, locale) })}
                </span>
              ) : null}
              {current !== 'free' ? (
                <button type="button" className="text-btn" onClick={() => void portal()} disabled={busy}>
                  {t('billing.manage')}
                </button>
              ) : null}
            </p>
          ) : null}

          {billingError || localError ? (
            <Note tone="warn">{t('billing.error', { message: localError ?? billingError ?? '' })}</Note>
          ) : null}

          <section className="plan-grid">
            {plans.map((plan) => {
              const isCurrent = plan.id === current;
              const isFree = plan.id === 'free';
              return (
                <article
                  key={plan.id}
                  className={`plan-card ${isCurrent ? 'is-current' : ''} ${isFree ? 'is-free' : ''}`}
                >
                  <header className="plan-card__head">
                    <h2 className="plan-card__name">{t(`plan.${plan.id}`)}</h2>
                    {isCurrent ? (
                      <span className="badge badge--ok">{t('billing.current')}</span>
                    ) : null}
                  </header>

                  {isFree ? (
                    <p className="plan-card__price">
                      {formatUsd(0)}
                      <span className="plan-card__period">{t('pricing.perMonth')}</span>
                    </p>
                  ) : (
                    <>
                      <p className="plan-card__price">
                        {priceOf(plan)}
                        <span className="plan-card__period">
                          {interval === 'year' ? t('pricing.perYear') : t('pricing.perMonth')}
                        </span>
                      </p>
                      <p className="plan-card__sub">
                        {interval === 'year'
                          ? t('pricing.annualMonthly', {
                              price: formatUsd(annualMonthlyCents(plan)),
                            })
                          : t('billing.pointValue')}
                      </p>
                    </>
                  )}

                  <ul className="plan-card__points">
                    <li>
                      <Icon name="sparkles" size={13} strokeWidth={1.6} />
                      {plan.monthlyQuestions > 0
                        ? t('pricing.monthlyQuestions', { n: plan.monthlyQuestions })
                        : plan.monthlyPoints > 0
                          ? t('pricing.monthlyPoints', { n: plan.monthlyPoints })
                          : t('billing.freeNoPoints')}
                    </li>
                    <li>
                      <Icon name="layers" size={13} strokeWidth={1.6} />
                      {plan.imagesPerMonth > 0
                        ? t('pricing.images', { n: plan.imagesPerMonth })
                        : t('pricing.noImages')}
                    </li>
                    <li>
                      <Icon name="book" size={13} strokeWidth={1.6} />
                      {t('pricing.materials', { n: plan.materialChars.toLocaleString(locale) })}
                    </li>
                  </ul>

                  <p className="plan-card__models">
                    <span className="field__label">{t('pricing.models')}</span>
                    {plan.models.map(modelLabel).join(' · ')}
                  </p>

                  <button
                    type="button"
                    className={`btn ${isCurrent ? 'btn--quiet' : 'btn--primary'} btn--block`}
                    disabled={busy || plan.id === 'free' || !stripeReady}
                    onClick={() => void onChoose(plan)}
                  >
                    {actionLabel(plan)}
                  </button>
                </article>
              );
            })}
          </section>
          <p className="footnote pricing__images-note">{t('pricing.imagesNote')}</p>
          <p className="footnote">{t('pricing.adaptiveNote')}</p>
          <p className="footnote pricing__contact">
            {t('pricing.contact')}{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </>
      )}
    </div>
  );
}
