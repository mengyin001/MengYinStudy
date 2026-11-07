/**
 * Billing state for the signed-in learner: plan, balance and the catalogue.
 *
 * The API is the single source of truth. This provider only caches the last
 * answer so every page can render the plan badge and the point balance without
 * firing its own request.
 */
import { planFor, type Plan, type PlanId } from '@mengyin/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getBillingConfig,
  getBillingMe,
  openBillingPortal,
  startCheckout,
  type BillingConfig,
  type BillingMe,
} from '@/services/billing';
import { useAuth } from './AuthContext';

export type BillingExternalAction = 'checkout' | 'portal';

interface BillingContextValue {
  config: BillingConfig | null;
  me: BillingMe | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  plan: Plan;
  points: number;
  /** Free-plan questions used and left this calendar month. */
  questionsUsed: number;
  questionsLimit: number;
  questionsRemaining: number | null;
  /** False when a stored paid subscription has expired or is past due. */
  membershipActive: boolean;
  /** Server-side plan enforcement is on and this account is signed in. */
  enforced: boolean;
  /** The Stripe tab that is waiting for the learner to report its result. */
  externalAction: BillingExternalAction | null;
  externalBusy: boolean;
  refresh(): Promise<void>;
  checkout(plan: Exclude<PlanId, 'free'>, interval: 'month' | 'year'): Promise<void>;
  portal(): Promise<void>;
  resolveExternal(outcome: 'success' | 'failure'): Promise<void>;
}

const POPUP_BLOCKED = 'popup-blocked';

/** Open a tab inside the click handler so the browser does not block it later. */
function openPendingTab(): Window | null {
  if (typeof window === 'undefined') return null;
  try {
    const tab = window.open('about:blank', '_blank');
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        // Some browsers make opener read-only; the tab still works.
      }
    }
    return tab;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useAuth();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [me, setMe] = useState<BillingMe | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [externalAction, setExternalAction] = useState<BillingExternalAction | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const awaitingExternal = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await getBillingConfig();
      setConfig(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReady(true);
    }
  }, []);

  const loadMe = useCallback(async () => {
    if (!auth.user) {
      setMe(null);
      return;
    }
    try {
      setMe(await getBillingMe());
    } catch {
      // A missing migration or an offline API must not break the shell; the
      // pages fall back to the free plan.
      setMe(null);
    }
  }, [auth.user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const refresh = useCallback(async () => {
    await Promise.all([load(), loadMe()]);
  }, [load, loadMe]);

  const startExternal = useCallback(
    async (
      action: BillingExternalAction,
      request: () => Promise<string>,
    ): Promise<void> => {
      setBusy(true);
      setError(null);
      // The blank tab must be opened before the first await, otherwise the
      // browser treats it as a pop-up rather than part of the click.
      const tab = openPendingTab();
      if (!tab) {
        setError(POPUP_BLOCKED);
        setBusy(false);
        return;
      }
      try {
        const url = await request();
        if (tab.closed) {
          setError(POPUP_BLOCKED);
          setBusy(false);
          return;
        }
        tab.location.replace(url);
        try {
          tab.focus();
        } catch {
          // A focus call is a nicety; never close the Stripe tab over it.
        }
        awaitingExternal.current = true;
        setExternalAction(action);
      } catch (caught) {
        try {
          tab.close();
        } catch {
          // The tab may already be closed by the learner.
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setBusy(false);
      }
    },
    [],
  );

  const checkout = useCallback(
    async (plan: Exclude<PlanId, 'free'>, interval: 'month' | 'year') => {
      await startExternal('checkout', () => startCheckout(plan, interval));
    },
    [startExternal],
  );

  const portal = useCallback(async () => {
    await startExternal('portal', openBillingPortal);
  }, [startExternal]);

  /**
   * The webhook may land just after the learner returns from Stripe. Poll the
   * snapshot briefly so a success confirmation does not reload into stale plan
   * data; the focus listener below is the fallback for a late webhook.
   */
  const waitForBillingChange = useCallback(async (before: BillingMe | null): Promise<void> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await delay(600);
      const next = await getBillingMe().catch(() => null);
      if (!next) continue;
      if (
        !before ||
        next.plan !== before.plan ||
        next.points !== before.points ||
        next.membershipActive !== before.membershipActive
      ) {
        return;
      }
    }
  }, []);

  const resolveExternal = useCallback(
    async (outcome: 'success' | 'failure'): Promise<void> => {
      if (!externalAction) return;
      if (outcome === 'failure') {
        if (externalBusy) return;
        setExternalAction(null);
        setBusy(false);
        // Keep awaitingExternal true: a learner who clicked the wrong answer
        // still gets a refresh when they return to this tab.
        return;
      }
      setExternalBusy(true);
      try {
        await waitForBillingChange(me);
        await refresh();
        awaitingExternal.current = false;
        setExternalBusy(false);
        setExternalAction(null);
        setBusy(false);
        window.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setExternalBusy(false);
      }
    },
    [externalAction, externalBusy, me, refresh, waitForBillingChange],
  );

  useEffect(() => {
    const onFocus = () => {
      if (!awaitingExternal.current) return;
      awaitingExternal.current = false;
      void loadMe();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadMe]);

  const plan = useMemo(() => planFor(me?.plan ?? 'free'), [me?.plan]);
  // Enforcement is a server property, not a property of being signed in. A
  // guest still sees the real policy note; the Generate page shows its sign-in
  // panel before any plan check.
  const enforced = me?.enforced ?? config?.enforced ?? false;
  const questionsLimit = me?.questionsLimit ?? plan.monthlyQuestions;
  const questionsUsed = me?.questionsUsed ?? 0;
  const questionsRemaining =
    me?.questionsRemaining ?? (plan.monthlyQuestions > 0 ? plan.monthlyQuestions : null);

  const value = useMemo<BillingContextValue>(
    () => ({
      config,
      me,
      ready,
      busy,
      error,
      plan,
      points: me?.points ?? 0,
      questionsUsed,
      questionsLimit,
      questionsRemaining,
      membershipActive: me?.membershipActive ?? true,
      enforced,
      externalAction,
      externalBusy,
      refresh,
      checkout,
      portal,
      resolveExternal,
    }),
    [
      busy,
      checkout,
      config,
      enforced,
      error,
      externalAction,
      externalBusy,
      me,
      plan,
      portal,
      questionsLimit,
      questionsRemaining,
      questionsUsed,
      ready,
      refresh,
      resolveExternal,
    ],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  const value = useContext(BillingContext);
  if (!value) throw new Error('useBilling must be used inside BillingProvider');
  return value;
}
