import { Note, Sheet } from './ui';
import { useApp } from '@/state/AppContext';
import { useBilling } from '@/state/BillingContext';

/**
 * The learner completes Stripe in a new tab. This dialog keeps the original
 * page in place and asks for the outcome, so a mistaken click can be undone
 * without losing the plan card. Closing the sheet counts as "not completed";
 * a focus refresh still picks up a payment that actually succeeded.
 */
export function BillingExternalDialog() {
  const { t } = useApp();
  const { externalAction, externalBusy, resolveExternal } = useBilling();
  if (!externalAction) return null;

  const checkout = externalAction === 'checkout';
  return (
    <Sheet
      open
      title={t('billing.externalTitle')}
      onClose={() => void resolveExternal('failure')}
      footer={
        <>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => void resolveExternal('failure')}
            disabled={externalBusy}
          >
            {t(checkout ? 'billing.paymentFailed' : 'billing.portalNotDone')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void resolveExternal('success')}
            disabled={externalBusy}
          >
            {externalBusy
              ? t('billing.externalRefreshing')
              : t(checkout ? 'billing.paymentSuccess' : 'billing.portalDone')}
          </button>
        </>
      }
    >
      <p>
        {t(checkout ? 'billing.externalCheckoutBody' : 'billing.externalPortalBody')}
      </p>
      <Note>{t('billing.externalHint')}</Note>
    </Sheet>
  );
}
