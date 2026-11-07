import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icons';
import { OfficialStatus } from '@/components/OfficialStatus';
import { Note, PageHead, Sheet } from '@/components/ui';
import { describeBackendError } from '@/i18n/backend';
import { formatDate, formatShortDay } from '@/lib/format';
import { navigate } from '@/lib/router';
import {
  cancelBillingSubscription,
  getRefundQuote,
  requestRefund,
  type RefundQuote,
  type RefundReason,
  type RefundReceipt,
} from '@/services/billing';
import { toBackendError, type BackendError } from '@/services/errors';
import type { MessageKey } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useBilling } from '@/state/BillingContext';
import { useUserDecks } from '@/state/UserDecksContext';
import { useUserLibrary } from '@/state/UserLibraryContext';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? '?';
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

function money(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const REFUND_REASON_KEYS: Record<RefundReason, MessageKey> = {
  not_paid: 'refund.reason.not_paid',
  not_active: 'refund.reason.not_active',
  outside_window: 'refund.reason.outside_window',
  no_payment: 'refund.reason.no_payment',
  no_plan_points: 'refund.reason.no_plan_points',
  no_unused_points: 'refund.reason.no_unused_points',
  unsupported_invoice: 'refund.reason.unsupported_invoice',
  already_refunded: 'refund.reason.already_refunded',
  unavailable: 'refund.reason.unavailable',
};

export function AccountPage() {
  const { t, locale, actions: appActions } = useApp();
  const { state, configured, configReason, actions } = useAuth();
  const {
    plan,
    points,
    me,
    questionsLimit,
    questionsRemaining,
    enforced,
    error: billingError,
    refresh: refreshBilling,
  } = useBilling();
  const { state: cloud } = useUserDecks();
  const { state: library } = useUserLibrary();
  const user = state.user;
  const profile = state.profile;
  const displayName = profile?.displayName ?? user?.displayName ?? user?.email ?? '';
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BackendError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<BackendError | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundQuote, setRefundQuote] = useState<RefundQuote | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundReceipt, setRefundReceipt] = useState<RefundReceipt | null>(null);

  useEffect(() => {
    setName(displayName);
  }, [displayName]);

  // The profile page is where the learner checks the image/point counters.
  // Read a fresh snapshot on arrival instead of showing the last cached value.
  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  const save = async () => {
    setError(null);
    setBusy(true);
    const result = await actions.updateProfile({ displayName: name });
    setBusy(false);
    if (result.ok) appActions.notify('success', t('account.saved'));
    else setError(result.error);
  };

  const signOut = async () => {
    setBusy(true);
    const result = await actions.signOut();
    setBusy(false);
    if (result.ok) {
      appActions.notify('info', t('account.signedOut'));
      navigate('/login', { replace: true });
    } else {
      setError(result.error);
    }
  };

  const copyId = async () => {
    if (!user?.id) return;
    let copied = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(user.id);
        copied = true;
      } catch {
        // Fall through to the selection-based copy below.
      }
    }
    if (!copied) {
      try {
        const area = document.createElement('textarea');
        area.value = user.id;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        copied = document.execCommand('copy');
        area.remove();
      } catch {
        copied = false;
      }
    }
    if (copied) appActions.notify('success', t('account.idCopied'));
  };

  const memberSince = profile?.createdAt ? Date.parse(profile.createdAt) : Number.NaN;
  const provider = user?.provider ?? 'email';
  const role = profile?.role === 'admin' ? t('account.admin') : t('account.user');
  const avatar = profile?.avatarUrl ?? user?.avatarUrl ?? null;
  const pointsResetAt = me?.pointsResetAt ? Date.parse(me.pointsResetAt) : Number.NaN;

  // The learner types the word itself: a stray click on a destructive button
  // should not end an account, and the sheet should slow the decision down.
  const deleteWord = t('account.deleteWord');
  const canDelete = deleteTyped.trim().toUpperCase() === deleteWord.trim().toUpperCase();
  // A paid or past-due account still has a Stripe subscription. Stop its
  // renewal before the Supabase row disappears, otherwise Stripe would keep
  // charging an account that no longer exists.
  const needsBillingCancel = me
    ? me.plan !== 'free' || ['past_due', 'unpaid', 'paused'].includes(me.status ?? '')
    : false;

  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteTyped('');
    setDeleteError(null);
  };

  const removeAccount = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    if (needsBillingCancel) {
      try {
        await cancelBillingSubscription();
      } catch (caught) {
        setDeleting(false);
        setDeleteError(toBackendError(caught));
        return;
      }
    }
    const result = await actions.deleteAccount();
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleteOpen(false);
    setDeleteTyped('');
    appActions.notify('success', t('account.deleted'));
    navigate('/', { replace: true });
  };

  const openRefund = async () => {
    setRefundOpen(true);
    setRefundQuote(null);
    setRefundReceipt(null);
    setRefundError(null);
    setRefundLoading(true);
    try {
      setRefundQuote(await getRefundQuote());
    } catch (caught) {
      setRefundError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefundLoading(false);
    }
  };

  const closeRefund = () => {
    if (refundBusy) return;
    setRefundOpen(false);
    setRefundQuote(null);
    setRefundError(null);
    setRefundReceipt(null);
  };

  const confirmRefund = async () => {
    if (!refundQuote?.eligible || refundBusy) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      const receipt = await requestRefund();
      setRefundReceipt(receipt);
      await refreshBilling();
      appActions.notify('success', t('refund.doneTitle'));
    } catch (caught) {
      setRefundError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefundBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        title={t('account.title')}
        lede={t('account.lede')}
        actions={
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => void signOut()} disabled={busy}>
            {t('account.signOut')}
          </button>
        }
      />

      {!configured ? (
        <>
          <Note tone="warn">{t('auth.unconfiguredBody')}</Note>
          {configReason ? <p className="footnote">{configReason}</p> : null}
        </>
      ) : null}
      {state.profileError ? (
        <Note tone="warn">{describeBackendError(state.profileError, t)}</Note>
      ) : null}
      {error ? (
        <p className="notice notice--warn" role="alert">
          {describeBackendError(error, t)}
        </p>
      ) : null}
      {state.recovery ? (
        <Note tone="warn">
          {t('account.recoveryNotice')}{' '}
          <button type="button" className="text-btn" onClick={() => navigate('/reset-password')}>
            {t('account.resetPassword')}
          </button>
        </Note>
      ) : null}

      <div className="account-grid">
        <section className="panel account-panel">
          <div className="account-identity">
            <span className="account-avatar" aria-hidden="true">
              {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initialsOf(displayName)}
            </span>
            <div className="account-identity__text">
              <h2 className="account-name">{displayName || t('account.unnamed')}</h2>
              <p className="account-email">{user?.email ?? '—'}</p>
              <p className="account-badges">
                <span className="badge badge--official">{role}</span>
                <span className="badge">{provider}</span>
                {user?.emailConfirmed ? <span className="badge badge--ok">{t('account.verified')}</span> : null}
              </p>
            </div>
          </div>

          <div className="account-form">
            <label className="field">
              <span className="field__label">{t('account.displayName')}</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
              <span className="field__hint">{t('account.displayNameHint')}</span>
            </label>
            <div className="actions-row">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void save()}
                disabled={busy || name.trim().length === 0 || name.trim() === displayName}
              >
                <Icon name="check" size={13} strokeWidth={1.8} />
                {busy ? t('auth.working') : t('account.save')}
              </button>
            </div>
          </div>

          <dl className="account-kv">
            <div>
              <dt>{t('account.role')}</dt>
              <dd>{role}</dd>
            </div>
            <div>
              <dt>{t('account.provider')}</dt>
              <dd>{provider}</dd>
            </div>
            <div>
              <dt>{t('account.memberSince')}</dt>
              <dd>
                {Number.isFinite(memberSince) ? formatDate(memberSince, locale) : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('account.id')}</dt>
              <dd className="account-id">
                <code>{user?.id ?? '—'}</code>
                {user?.id ? (
                  <button type="button" className="text-btn" onClick={() => void copyId()}>
                    {t('account.copyId')}
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{t('account.cloudDecks')}</dt>
              <dd>{cloud.decks.length}</dd>
            </div>
            <div>
              <dt>{t('account.officialDecks')}</dt>
              <dd>{library.refs.length}</dd>
            </div>
          </dl>
        </section>

        <section className="panel account-panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('account.backend')}</h2>
            <span className="panel__more">{configured ? t('account.connected') : t('account.notConnected')}</span>
          </div>
          <OfficialStatus detailed />
          <div className="account-notes">
            <p className="footnote">{t('account.backendHint')}</p>
            <p className="footnote">{t('account.localNote')}</p>
          </div>
        </section>
      </div>

      <section className="panel account-panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('account.billing')}</h2>
          <button type="button" className="panel__more" onClick={() => navigate('/pricing')}>
            {t('account.viewPlans')} →
          </button>
        </div>
        <div className="account-billing__row">
          <span className="badge badge--official">{t(`plan.${plan.id}`)}</span>
          {plan.id === 'free' ? (
            <strong>
              {t('gen.freeRemaining', {
                n: questionsRemaining ?? questionsLimit,
                limit: questionsLimit,
              })}
            </strong>
          ) : (
            <strong>{t('billing.points', { n: points })}</strong>
          )}
          {me && !me.membershipActive ? (
            <span className="footnote">{t('gen.membershipInactive')}</span>
          ) : null}
          {me ? (
            <span className="footnote">
              {plan.imagesPerMonth > 0
                ? t('billing.imagesUsed', { used: me.imagesUsed, limit: me.imagesPerMonth })
                : t('billing.noAiImages')}
            </span>
          ) : null}
          {me && me.monthlyPoints > 0 ? (
            <span className="footnote">{t('account.monthlyPoints', { n: me.monthlyPoints })}</span>
          ) : null}
          {me && me.bonusPoints > 0 ? (
            <span className="footnote">{t('account.bonusPoints', { n: me.bonusPoints })}</span>
          ) : null}
          {Number.isFinite(pointsResetAt) ? (
            <span className="footnote">
              {t('account.pointsReset', { date: formatShortDay(pointsResetAt, locale) })}
            </span>
          ) : null}
          {!enforced ? <span className="footnote">{t('billing.unenforced')}</span> : null}
          <button type="button" className="btn btn--sm" onClick={() => navigate('/pricing')}>
            {t('account.viewPlans')}
          </button>
          <button type="button" className="text-btn" onClick={() => navigate('/docs/billing')}>
            {t('billingDocs.title')}
          </button>
          {me?.membershipActive && plan.id !== 'free' ? (
            <button type="button" className="text-btn" onClick={() => void openRefund()}>
              {t('refund.request')}
            </button>
          ) : null}
        </div>
        <p className="footnote">{t('account.billingHint')}</p>
        {billingError ? (
          <Note tone="warn">
            {t('billing.error', {
              message:
                billingError === 'popup-blocked'
                  ? t('billing.popupBlocked')
                  : billingError,
            })}
          </Note>
        ) : null}
        {me?.latestRefund?.status === 'failed' ||
        me?.latestRefund?.status === 'canceled' ? (
          <Note tone="warn">
            {t('refund.failedNotice', {
              amount: money(
                me.latestRefund.amountCents,
                me.latestRefund.currency,
                locale,
              ),
            })}
          </Note>
        ) : null}
        {me?.latestRefund?.status === 'pending' ? (
          <Note>
            {t('refund.pendingNotice', {
              amount: money(
                me.latestRefund.amountCents,
                me.latestRefund.currency,
                locale,
              ),
            })}
          </Note>
        ) : null}
        {me?.latestRefund?.status === 'requires_action' ? (
          <Note tone="warn">
            {t('refund.requiresActionNotice', {
              amount: money(
                me.latestRefund.amountCents,
                me.latestRefund.currency,
                locale,
              ),
            })}
          </Note>
        ) : null}
      </section>

      <Note>{t('account.securityNote')}</Note>

      <section className="panel account-danger">
        <div className="panel__head">
          <h2 className="panel__title">{t('account.deleteTitle')}</h2>
        </div>
        <p className="footnote">{t('account.deleteBody')}</p>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setDeleteOpen(true)}
            disabled={busy || deleting}
          >
            {t('account.deleteAction')}
          </button>
        </div>
      </section>

      <Sheet
        open={deleteOpen}
        title={t('account.deleteTitle')}
        onClose={closeDelete}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={closeDelete} disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void removeAccount()}
              disabled={!canDelete || deleting}
            >
              {deleting ? t('account.deleting') : t('account.deleteConfirm')}
            </button>
          </>
        }
      >
        <p>{t('account.deleteSheetBody')}</p>
        <ul className="delete-list">
          <li>{t('account.deleteItemProfile')}</li>
          <li>{t('account.deleteItemDecks')}</li>
          <li>{t('account.deleteItemProgress')}</li>
          <li>{t('account.deleteItemLibrary')}</li>
        </ul>
        <p className="footnote">{t('account.deleteKeep')}</p>
        {needsBillingCancel ? <p className="footnote">{t('account.deleteBilling')}</p> : null}
        <label className="field">
          <span className="field__label">{t('account.deleteTypeLabel', { word: deleteWord })}</span>
          <input
            type="text"
            value={deleteTyped}
            onChange={(event) => setDeleteTyped(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={deleteWord}
          />
        </label>
        {deleteError ? (
          <Note tone="warn">{describeBackendError(deleteError, t)}</Note>
        ) : null}
      </Sheet>

      <Sheet
        open={refundOpen}
        title={t('refund.title')}
        onClose={closeRefund}
        footer={
          refundReceipt ? (
            <button type="button" className="btn btn--primary" onClick={closeRefund}>
              {t('refund.close')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={closeRefund}
                disabled={refundBusy}
              >
                {t('common.cancel')}
              </button>
              {refundQuote?.eligible ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void confirmRefund()}
                  disabled={refundBusy}
                >
                  {refundBusy
                    ? t('refund.working')
                    : t('refund.confirm', {
                        amount: money(refundQuote.amountCents, refundQuote.currency, locale),
                      })}
                </button>
              ) : null}
            </>
          )
        }
      >
        {refundLoading ? <Note>{t('refund.loading')}</Note> : null}
        {refundError ? <Note tone="warn">{refundError}</Note> : null}

        {refundReceipt ? (
          <>
            <p>
              {refundReceipt.alreadyRefunded
                ? t('refund.doneAlready')
                : refundReceipt.status === 'pending' ||
                    refundReceipt.status === 'requires_action'
                  ? t('refund.donePending', {
                      amount: money(
                        refundReceipt.amountCents,
                        refundReceipt.currency,
                        locale,
                      ),
                    })
                  : t('refund.doneBody', {
                      amount: money(
                        refundReceipt.amountCents,
                        refundReceipt.currency,
                        locale,
                      ),
                    })}
            </p>
            {!refundReceipt.alreadyRefunded && !refundReceipt.subscriptionCanceled ? (
              <Note tone="warn">{t('refund.cancelFallback')}</Note>
            ) : null}
          </>
        ) : refundQuote ? (
          refundQuote.eligible ? (
            <>
              <p>
                {t('refund.summary', {
                  unused: refundQuote.unusedPoints,
                  monthly: refundQuote.monthlyPoints,
                  percent: Math.round(refundQuote.unusedRatio * 100),
                  amount: money(refundQuote.amountCents, refundQuote.currency, locale),
                  paid: money(refundQuote.paidCents, refundQuote.currency, locale),
                })}
              </p>
              {refundQuote.interval === 'year' ? (
                <p className="footnote">{t('refund.annualNote')}</p>
              ) : null}
              <p className="footnote">
                {t('refund.window', { days: refundQuote.windowDays })}
              </p>
              <Note tone="warn">{t('refund.warning')}</Note>
            </>
          ) : (
            <Note tone="warn">
              {t(REFUND_REASON_KEYS[refundQuote.reason ?? 'unavailable'])}
            </Note>
          )
        ) : null}

        <p className="footnote">
          <button type="button" className="text-btn" onClick={() => navigate('/docs/refunds')}>
            {t('refund.policy')}
          </button>
        </p>
      </Sheet>
    </div>
  );
}
