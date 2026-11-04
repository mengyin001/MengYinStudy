import { useMemo } from 'react';
import { computeStreak, dueCount } from '@mengyin/core';
import { AccountChip, MobileAccountButton } from './components/AccountChip';
import { BrandMark } from './components/BrandMark';
import { Icon, type IconName } from './components/Icons';
import { RequireAuth } from './components/RequireAuth';
import { Toast } from './components/Toast';
import { AccountPage } from './pages/Account';
import { AuthPage, ResetPasswordPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { GeneratePage } from './pages/Generate';
import { LandingPage } from './pages/Landing';
import { LegalPage } from './pages/Legal';
import { LibraryPage } from './pages/Library';
import { MistakesPage } from './pages/Mistakes';
import { PlazaPage } from './pages/Plaza';
import { PluginsPage } from './pages/Plugins';
import { PracticePage } from './pages/Practice';
import { SettingsPage } from './pages/Settings';
import { StatsPage } from './pages/StatsPage';
import { useApp } from './state/AppContext';
import { useAuth } from './state/AuthContext';
import type { MessageKey } from './i18n/messages';
import { navigate, useRoute } from './lib/router';
import { APP_VERSION } from './lib/version';

interface NavItem {
  path: string;
  key: MessageKey;
  icon: IconName;
}

const NAV: NavItem[] = [
  { path: '/today', key: 'nav.today', icon: 'home' },
  { path: '/library', key: 'nav.decks', icon: 'book' },
  { path: '/plaza', key: 'nav.plaza', icon: 'compass' },
  { path: '/generate', key: 'nav.generate', icon: 'sparkles' },
  { path: '/mistakes', key: 'nav.review', icon: 'flag' },
  { path: '/stats', key: 'nav.stats', icon: 'chart' },
  { path: '/plugins', key: 'nav.plugins', icon: 'layers' },
  { path: '/settings', key: 'nav.settings', icon: 'settings' },
];

const AUTH_ROUTES = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

/** Legal documents render standalone so a store reviewer never needs the shell. */
const LEGAL_ROUTES: Record<string, 'privacy' | 'terms'> = {
  '/privacy': 'privacy',
  '/terms': 'terms',
};

function isActive(routePath: string, path: string): boolean {
  // `/` is the public homepage for signed-out visitors but the dashboard for
  // signed-in ones, so the Today item owns both paths.
  if (path === '/today') return routePath === '/today' || routePath === '/' || routePath === '';
  return routePath === path || routePath.startsWith(`${path}/`);
}

export default function App() {
  const { state, entries, locale, t, actions } = useApp();
  const { state: authState } = useAuth();
  const route = useRoute();

  const streak = useMemo(() => computeStreak(state.progress.attempts).current, [state.progress.attempts]);
  const due = useMemo(() => dueCount(state.progress.cards), [state.progress.cards]);

  const page = useMemo(() => {
    switch (route.path) {
      case '/':
      case '':
      case '/today':
        return <DashboardPage />;
      case '/library':
        return <LibraryPage />;
      case '/plaza':
        return <PlazaPage />;
      case '/generate':
        return <GeneratePage />;
      case '/practice':
        return <PracticePage />;
      case '/mistakes':
        return <MistakesPage />;
      case '/stats':
        return <StatsPage />;
      case '/plugins':
        return <PluginsPage />;
      case '/settings':
        return <SettingsPage />;
      case '/login':
        return <AuthPage key="signin" mode="signin" />;
      case '/register':
        return <AuthPage key="signup" mode="signup" />;
      case '/forgot-password':
        return <AuthPage key="forgot" mode="forgot" />;
      case '/reset-password':
        return <ResetPasswordPage />;
      case '/account':
        return (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        );
      default:
        return <DashboardPage />;
    }
  }, [route.path]);

  if (!state.ready) {
    return (
      <div className="boot">
        <span className="boot__word">{t('app.name')}</span>
        <span className="boot__note">{t('common.loading')}</span>
      </div>
    );
  }

  const legal = LEGAL_ROUTES[route.path];

  // Authentication pages own the whole viewport; the app shell would distract
  // from a single decision and leaves no place for the marketing-style aside.
  if (AUTH_ROUTES.has(route.path)) {
    return (
      <>
        {page}
        <Toast />
      </>
    );
  }

  if (legal) {
    return (
      <>
        <LegalPage docId={legal} />
        <Toast />
      </>
    );
  }

  // The bare `/` is the public homepage for visitors who have not signed in.
  // Signed-in learners still get the dashboard there, and `/today` is the
  // stable in-app route for guests who want to start practising immediately.
  const publicHome =
    (route.path === '/' || route.path === '') && authState.status === 'anonymous';
  if (publicHome) {
    return (
      <>
        <LandingPage />
        <Toast />
      </>
    );
  }

  const appHome = authState.user ? '/' : '/today';

  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href={`#${appHome}`}
          onClick={(event) => {
            event.preventDefault();
            navigate(appHome);
          }}
        >
          <BrandMark className="brand__mark" />
          <span className="brand__word">{t('app.name')}</span>
        </a>

        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={`nav__link ${isActive(route.path, item.path) ? 'is-active' : ''}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} size={15} strokeWidth={1.5} />
              <span>{t(item.key)}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar__foot">
          <AccountChip />
          <p className="streak">
            {t('side.streak', { n: streak })} · {t('side.due', { n: due })}
          </p>
          <div className="lang-row">
            <button
              type="button"
              className={`lang-btn ${locale === 'en' ? 'is-active' : ''}`}
              onClick={() => actions.updateSettings({ locale: 'en' })}
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${locale === 'zh-Hant' ? 'is-active' : ''}`}
              onClick={() => actions.updateSettings({ locale: 'zh-Hant' })}
            >
              繁中
            </button>
            <span className="version">v{APP_VERSION}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="mobile-top">
          <BrandMark className="mobile-top__mark" />
          <span className="mobile-top__word">{t('app.name')}</span>
          <MobileAccountButton />
          <span className="mobile-top__meta">
            {entries.length} {t('common.questions')} · {t('side.due', { n: due })}
          </span>
        </div>
        <div className="main__inner">{page}</div>
      </main>

      <nav className="mobile-nav" aria-label="Sections">
        {NAV.filter((item) => item.path !== '/plugins').map((item) => (
          <a
            key={item.path}
            href={`#${item.path}`}
            className={`mobile-nav__link ${isActive(route.path, item.path) ? 'is-active' : ''}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(item.path);
            }}
          >
            <Icon name={item.icon} size={17} strokeWidth={1.5} />
            <span>{t(item.key)}</span>
          </a>
        ))}
      </nav>

      <Toast />
    </div>
  );
}
