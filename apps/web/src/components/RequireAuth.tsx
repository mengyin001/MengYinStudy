import { useEffect, type ReactNode } from 'react';
import { navigate, useRoute } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

/** Client-side guard. The real authorisation is enforced by Supabase RLS. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { t } = useApp();
  const route = useRoute();

  useEffect(() => {
    if (state.ready && state.status === 'anonymous') {
      navigate(`/login?next=${encodeURIComponent(route.path)}`, { replace: true });
    }
  }, [state.ready, state.status, route.path]);

  if (!state.ready) {
    return (
      <div className="page">
        <p className="lede">{t('common.loading')}</p>
      </div>
    );
  }
  if (state.status !== 'authenticated') return null;
  return <>{children}</>;
}
