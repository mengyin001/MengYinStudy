import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BillingReference } from '@/components/BillingReference';
import { BrandMark } from '@/components/BrandMark';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { docsUrl } from '@/lib/docs';
import { LEGAL_VERSION, LEGAL_UPDATED } from '@/legal/config';
import { navigate, parseHash } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import '@/styles/docs.css';

const SECTION_IDS = ['overview', 'ai', 'billing', 'refund', 'documents', 'contact'] as const;
type SectionId = (typeof SECTION_IDS)[number];

type DocNavItem =
  | { id: SectionId; label: string }
  | { href: string; label: string; external: true };

interface DocNavGroup {
  label: string;
  items: DocNavItem[];
}

function isSectionId(value: string | null): value is SectionId {
  return value !== null && (SECTION_IDS as readonly string[]).includes(value);
}

function resolveInitialSection(focus: SectionId | null): SectionId {
  const query = parseHash(window.location.hash).query.get('section');
  return isSectionId(query) ? query : focus ?? 'overview';
}

/**
 * The documentation site.
 *
 * It lives outside the application shell on purpose: a learner reading the
 * rules should not have to share the screen with a deck list. The layout has
 * three parts — a fixed guide rail, the document itself and a live contents
 * rail — and every section is addressable with `#/docs?section=…`.
 */
export function DocsPage({ focus }: { focus?: 'refund' | 'billing' }) {
  const { t, locale, actions } = useApp();

  const focusId: SectionId | null =
    focus === 'refund' ? 'refund' : focus === 'billing' ? 'billing' : null;
  const initialSection = useMemo(() => resolveInitialSection(focusId), [focusId]);
  const [active, setActive] = useState<SectionId>(initialSection);
  const mobileNav = useRef<HTMLDetailsElement>(null);

  const updatedLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh-Hant' ? 'zh-Hant' : 'en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(`${LEGAL_UPDATED}T00:00:00`)),
    [locale],
  );

  const sections = useMemo(
    () =>
      [
        { id: 'overview', label: t('docs.startTitle') },
        { id: 'ai', label: t('docs.aiTitle') },
        { id: 'billing', label: t('docs.billingTitle') },
        { id: 'refund', label: t('docs.refundTitle') },
        { id: 'documents', label: t('docs.policiesTitle') },
        { id: 'contact', label: t('docs.contactTitle') },
      ] satisfies { id: SectionId; label: string }[],
    [t],
  );

  const groups = useMemo<DocNavGroup[]>(
    () => [
      {
        label: t('docs.navStart'),
        items: [
          { id: 'overview' as const, label: t('docs.startTitle') },
          { id: 'ai' as const, label: t('docs.aiTitle') },
        ],
      },
      {
        label: t('docs.navBilling'),
        items: [
          { id: 'billing' as const, label: t('docs.billingTitle') },
          { id: 'refund' as const, label: t('docs.refundTitle') },
        ],
      },
      {
        label: t('docs.navPolicies'),
        items: [
          { id: 'documents' as const, label: t('docs.policiesTitle') },
          { href: docsUrl('/privacy'), label: t('docs.policyPrivacyTitle'), external: true },
          { href: docsUrl('/terms'), label: t('docs.policyTermsTitle'), external: true },
        ],
      },
      {
        label: t('docs.navSupport'),
        items: [{ id: 'contact' as const, label: t('docs.contactTitle') }],
      },
    ],
    [t],
  );

  useEffect(() => {
    document.title = `${t('docs.title')} · MengYin Study`;
  }, [t]);

  const scrollTo = useCallback((id: SectionId, updateUrl = true) => {
    const element = document.getElementById(`docs-${id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    if (updateUrl) window.history.replaceState(null, '', `#/docs?section=${id}`);
  }, []);

  // Arriving from `/docs/refunds`, or with a `?section=` deep link, should land
  // on the relevant heading rather than at the top of the document.
  useEffect(() => {
    if (initialSection === 'overview') {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const timer = window.setTimeout(() => scrollTo(initialSection, false), 60);
    return () => window.clearTimeout(timer);
  }, [initialSection, scrollTo]);

  // The contents rail follows the reading position. A small marker below the
  // sticky header is enough; IntersectionObserver behaves inconsistently when
  // several sections are taller than the viewport.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: SectionId = 'overview';
      for (const id of SECTION_IDS) {
        const element = document.getElementById(`docs-${id}`);
        if (element && element.getBoundingClientRect().top <= 132) current = id;
      }
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 8
      ) {
        current = 'contact';
      }
      setActive(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const renderNav = (onNavigate?: () => void) => (
    <nav aria-label={t('docs.title')}>
      {groups.map((group) => (
        <div className="docs-side__group" key={group.label}>
          <p className="docs-side__label">{group.label}</p>
          {group.items.map((item) =>
            'id' in item ? (
              <a
                key={item.id}
                className={`docs-side__link ${active === item.id ? 'is-active' : ''}`}
                href={`#/docs?section=${item.id}`}
                aria-current={active === item.id ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (onNavigate) {
                    onNavigate();
                    window.requestAnimationFrame(() => scrollTo(item.id));
                  } else {
                    scrollTo(item.id);
                  }
                }}
              >
                {item.label}
              </a>
            ) : (
              <a
                key={item.href}
                className="docs-side__link docs-side__link--external"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{item.label}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ),
          )}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="docs-page">
      <header className="docs-top">
        <a
          className="docs-brand"
          href="#/today"
          onClick={(event) => {
            event.preventDefault();
            navigate('/today');
          }}
        >
          <BrandMark className="docs-brand__mark" />
          <span className="docs-brand__word">{t('app.name')}</span>
          <span className="docs-brand__divider" aria-hidden="true">
            /
          </span>
          <span className="docs-brand__section">{t('docs.badge')}</span>
        </a>

        <div className="docs-top__actions">
          <div className="docs-lang" role="group" aria-label={t('docs.language')}>
            <button
              type="button"
              className={`docs-lang__btn ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => actions.updateSettings({ locale: 'en' })}
            >
              EN
            </button>
            <button
              type="button"
              className={`docs-lang__btn ${locale === 'zh-Hant' ? 'is-active' : ''}`}
              aria-pressed={locale === 'zh-Hant'}
              onClick={() => actions.updateSettings({ locale: 'zh-Hant' })}
            >
              繁中
            </button>
          </div>
          <a
            className="docs-top__app"
            href="#/today"
            onClick={(event) => {
              event.preventDefault();
              navigate('/today');
            }}
          >
            {t('docs.openApp')}
          </a>
        </div>
      </header>

      <div className="docs-shell">
        <aside className="docs-side">{renderNav()}</aside>

        <main className="docs-main">
          <article className="docs-article">
            <header className="docs-hero">
              <p className="docs-eyebrow">{t('docs.kicker')}</p>
              <h1>{t('docs.title')}</h1>
              <p className="docs-hero__lede">{t('docs.lede')}</p>
              <p className="docs-hero__meta">
                {t('docs.updated', { date: updatedLabel })} · v{LEGAL_VERSION}
              </p>
            </header>

            <details className="docs-mobile-nav" ref={mobileNav}>
              <summary>{t('docs.contents')}</summary>
              <div className="docs-mobile-nav__body">
                {renderNav(() => {
                  if (mobileNav.current) mobileNav.current.open = false;
                })}
              </div>
            </details>

            <section className="docs-section" id="docs-overview">
              <h2>{t('docs.startTitle')}</h2>
              <p className="docs-section__lede">{t('docs.startLede')}</p>
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

            <section className="docs-section" id="docs-ai">
              <h2>{t('docs.aiTitle')}</h2>
              <p className="docs-section__lede">{t('docs.aiBody')}</p>
            </section>

            <BillingReference />

            <section className="docs-section" id="docs-refund">
              <h2>{t('docs.refundTitle')}</h2>
              <p className="docs-section__lede">{t('docs.refundIntro')}</p>

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

            <section className="docs-section" id="docs-documents">
              <h2>{t('docs.policiesTitle')}</h2>
              <p className="docs-section__lede">{t('docs.policiesLede')}</p>
              <div className="docs-cards">
                <button
                  type="button"
                  className="docs-card"
                  onClick={() => scrollTo('billing')}
                >
                  <span className="docs-card__label">{t('docs.policyBillingTitle')}</span>
                  <span className="docs-card__body">{t('docs.policyBillingBody')}</span>
                </button>
                <button
                  type="button"
                  className="docs-card"
                  onClick={() => scrollTo('refund')}
                >
                  <span className="docs-card__label">{t('docs.policyRefundTitle')}</span>
                  <span className="docs-card__body">{t('docs.policyRefundBody')}</span>
                </button>
                <a
                  className="docs-card"
                  href={docsUrl('/privacy')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="docs-card__label">{t('docs.policyPrivacyTitle')}</span>
                  <span className="docs-card__body">{t('docs.policyPrivacyBody')}</span>
                  <span className="docs-card__meta">↗</span>
                </a>
                <a
                  className="docs-card"
                  href={docsUrl('/terms')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="docs-card__label">{t('docs.policyTermsTitle')}</span>
                  <span className="docs-card__body">{t('docs.policyTermsBody')}</span>
                  <span className="docs-card__meta">↗</span>
                </a>
              </div>
            </section>

            <section className="docs-section" id="docs-contact">
              <h2>{t('docs.contactTitle')}</h2>
              <p className="docs-section__lede">
                {t('docs.contactBody')}{' '}
                <a className="docs-link" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </section>
          </article>
        </main>

        <aside className="docs-toc" aria-label={t('docs.onThisPage')}>
          <p className="docs-toc__title">{t('docs.onThisPage')}</p>
          <nav>
            {sections.map((section) => (
              <a
                key={section.id}
                className={`docs-toc__link ${active === section.id ? 'is-active' : ''}`}
                href={`#/docs?section=${section.id}`}
                aria-current={active === section.id ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  scrollTo(section.id);
                }}
              >
                {section.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}
