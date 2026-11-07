import { useEffect } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { browserLegalContext } from '@/legal/config';
import { LANDING, type Bi } from '@/landing/copy';
import { docsUrl } from '@/lib/docs';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';

function text(value: Bi, locale: 'en' | 'zh-Hant'): string {
  return locale === 'zh-Hant' ? value.zh : value.en;
}

/**
 * The public homepage.
 *
 * Signed-out visitors land here instead of the study dashboard, so a person
 * (or a reviewer) can read what the app is, how it uses Google data and what
 * it will never be used for before deciding to sign in. The page is linked
 * from the OAuth consent screen, so the name and purpose have to be literal,
 * not marketing shorthand.
 */
export function LandingPage() {
  const { locale, actions } = useApp();

  useEffect(() => {
    document.title = 'MengYin Study';
    document.documentElement.lang = locale === 'zh-Hant' ? 'zh-Hant' : 'en';
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [locale]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const year = new Date().getFullYear();
  const contactEmail = browserLegalContext().contactEmail;

  return (
    <div className="landing">
      <header className="landing__top">
        <a
          className="landing__brand"
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <BrandMark className="landing__mark" />
          <span className="landing__word">MengYin Study</span>
        </a>

        <nav className="landing__nav" aria-label="Homepage sections">
          <button type="button" onClick={() => scrollTo('features')}>
            {text(LANDING.features.eyebrow, locale)}
          </button>
          <button type="button" onClick={() => scrollTo('how-it-works')}>
            {text(LANDING.how.eyebrow, locale)}
          </button>
          <button type="button" onClick={() => navigate('/pricing')}>
            {text(LANDING.nav.pricing, locale)}
          </button>
          <a href="./privacy/">{text(LANDING.footer.privacy, locale)}</a>
        </nav>

        <div className="landing__top-actions">
          <div className="landing__lang" role="group" aria-label="Language">
            <button
              type="button"
              className={`lang-btn ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => actions.updateSettings({ locale: 'en' })}
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${locale === 'zh-Hant' ? 'is-active' : ''}`}
              aria-pressed={locale === 'zh-Hant'}
              onClick={() => actions.updateSettings({ locale: 'zh-Hant' })}
            >
              繁中
            </button>
          </div>
          <button type="button" className="btn landing__signin" onClick={() => navigate('/login')}>
            {text(LANDING.ctaSignIn, locale)}
          </button>
          <button
            type="button"
            className="btn btn--primary landing__top-cta"
            onClick={() => navigate('/register')}
          >
            {text(LANDING.ctaCreate, locale)}
          </button>
        </div>
      </header>

      <main>
        <section className="landing__hero">
          <div className="landing__hero-copy">
            <p className="eyebrow">{text(LANDING.eyebrow, locale)}</p>
            <h1 className="landing__title">MengYin Study</h1>
            <p className="landing__lede">{text(LANDING.heroLede, locale)}</p>
            <p className="landing__body">{text(LANDING.heroBody, locale)}</p>

            <div className="landing__cta">
              <button type="button" className="btn btn--primary landing__cta-main" onClick={() => navigate('/today')}>
                {text(LANDING.ctaPrimary, locale)}
              </button>
              <button type="button" className="btn landing__cta-side" onClick={() => navigate('/login')}>
                {text(LANDING.ctaSignIn, locale)}
              </button>
              <button type="button" className="btn btn--quiet landing__cta-side" onClick={() => navigate('/register')}>
                {text(LANDING.ctaCreate, locale)}
              </button>
            </div>
            <p className="landing__note">{text(LANDING.ctaNote, locale)}</p>
            <a
              className="landing__inline-link"
              href="#/pricing"
              onClick={(event) => {
                event.preventDefault();
                navigate('/pricing');
              }}
            >
              {text(LANDING.ctaPricing, locale)} →
            </a>
          </div>

          <div className="landing__preview" aria-label={text(LANDING.preview.label, locale)}>
            <div className="landing__preview-bar">
              <span className="landing__preview-title">{text(LANDING.preview.title, locale)}</span>
              <span className="landing__preview-tag">{text(LANDING.preview.label, locale)}</span>
            </div>

            <div className="landing__preview-metrics">
              <div>
                <span className="landing__preview-value">12</span>
                <span className="landing__preview-label">{text(LANDING.preview.due, locale).replace(/^\d+\s*/, '')}</span>
              </div>
              <div>
                <span className="landing__preview-value">3</span>
                <span className="landing__preview-label">{text(LANDING.preview.mistakes, locale).replace(/^\d+\s*/, '')}</span>
              </div>
              <div>
                <span className="landing__preview-value">86%</span>
                <span className="landing__preview-label">{text(LANDING.preview.accuracy, locale).replace(/^\d+%\s*/, '')}</span>
              </div>
            </div>

            <div className="landing__preview-q">
              <p className="landing__preview-meta">{text(LANDING.preview.questionLabel, locale)}</p>
              <p className="landing__preview-prompt">{text(LANDING.preview.question, locale)}</p>
              <div className="landing__preview-option is-correct">
                <span>{text(LANDING.preview.optionCorrect, locale)}</span>
                <span aria-hidden="true">✓</span>
              </div>
              <div className="landing__preview-option">
                <span>{text(LANDING.preview.optionWrong, locale)}</span>
              </div>
              <p className="landing__preview-explain">{text(LANDING.preview.explanation, locale)}</p>
            </div>

            <p className="landing__preview-foot">{text(LANDING.preview.footer, locale)}</p>
          </div>
        </section>

        <section className="landing__section" id="features">
          <header className="landing__section-head">
            <p className="eyebrow">{text(LANDING.features.eyebrow, locale)}</p>
            <h2 className="landing__section-title">{text(LANDING.features.title, locale)}</h2>
            <p className="landing__section-body">{text(LANDING.features.body, locale)}</p>
          </header>

          <div className="landing__grid">
            {LANDING.features.items.map((item) => (
              <article className="landing__card" key={item.number}>
                <span className="landing__card-num">{item.number}</span>
                <h3>{text(item.title, locale)}</h3>
                <p>{text(item.body, locale)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing__section landing__section--rule" id="how-it-works">
          <header className="landing__section-head">
            <p className="eyebrow">{text(LANDING.how.eyebrow, locale)}</p>
            <h2 className="landing__section-title">{text(LANDING.how.title, locale)}</h2>
          </header>

          <div className="landing__steps">
            {LANDING.how.steps.map((step) => (
              <article className="landing__step" key={step.number}>
                <span className="landing__step-num">{step.number}</span>
                <h3>{text(step.title, locale)}</h3>
                <p>{text(step.body, locale)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing__section landing__section--rule landing__audience">
          <div>
            <p className="eyebrow">{text(LANDING.audience.eyebrow, locale)}</p>
            <h2 className="landing__section-title">{text(LANDING.audience.title, locale)}</h2>
            <p className="landing__section-body">{text(LANDING.audience.body, locale)}</p>
          </div>
          <ul className="landing__audience-list">
            {LANDING.audience.points.map((point) => (
              <li key={point.en}>{text(point, locale)}</li>
            ))}
          </ul>
        </section>

        <section className="landing__section landing__section--rule" id="ai">
          <header className="landing__section-head">
            <p className="eyebrow">{text(LANDING.ai.eyebrow, locale)}</p>
            <h2 className="landing__section-title">{text(LANDING.ai.title, locale)}</h2>
            <p className="landing__section-body">{text(LANDING.ai.body, locale)}</p>
          </header>

          <ul className="landing__checklist landing__checklist--tight">
            {LANDING.ai.points.map((point) => (
              <li key={point.en}>{text(point, locale)}</li>
            ))}
          </ul>

          <p className="landing__policy">{text(LANDING.ai.policy, locale)}</p>
          <a className="landing__inline-link" href="./terms/">
            {text(LANDING.ai.termsLabel, locale)} →
          </a>
        </section>

        <section className="landing__section landing__section--rule landing__data" id="data">
          <header className="landing__section-head">
            <p className="eyebrow">{text(LANDING.google.eyebrow, locale)}</p>
            <h2 className="landing__section-title">{text(LANDING.google.title, locale)}</h2>
            <p className="landing__section-body">{text(LANDING.google.body, locale)}</p>
          </header>
          <ul className="landing__checklist landing__checklist--tight">
            {LANDING.google.points.map((point) => (
              <li key={point.en}>{text(point, locale)}</li>
            ))}
          </ul>
          <p className="landing__fine">
            {text(LANDING.google.limitedUse, locale)}{' '}
            <a href={LANDING.google.policyHref} target="_blank" rel="noreferrer noopener">
              {text(LANDING.google.policyLabel, locale)}
            </a>
            .
          </p>
          <p className="landing__fine landing__fine--strong">{text(LANDING.google.apiOnlyForSignIn, locale)}</p>
        </section>

        <section className="landing__closing">
          <div className="landing__closing-inner">
            <div>
              <h2>{text(LANDING.cta.title, locale)}</h2>
              <p>{text(LANDING.cta.body, locale)}</p>
            </div>
            <div className="landing__cta">
              <button type="button" className="btn btn--primary landing__cta-main" onClick={() => navigate('/today')}>
                {text(LANDING.ctaPrimary, locale)}
              </button>
              <button type="button" className="btn landing__cta-side" onClick={() => navigate('/register')}>
                {text(LANDING.ctaCreate, locale)}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing__foot">
        <div className="landing__foot-brand">
          <BrandMark className="landing__mark" />
          <div>
            <p className="landing__foot-name">MengYin Study</p>
            <p className="landing__foot-tag">{text(LANDING.footer.tagline, locale)}</p>
          </div>
        </div>

        <nav className="landing__foot-links" aria-label="Legal and contact">
          <a href={docsUrl('/docs')} target="_blank" rel="noopener noreferrer">
            {text(LANDING.footer.docs, locale)}
          </a>
          <a href="./privacy/">{text(LANDING.footer.privacy, locale)}</a>
          <a href="./terms/">{text(LANDING.footer.terms, locale)}</a>
          <a href="#/pricing" onClick={(event) => {
            event.preventDefault();
            navigate('/pricing');
          }}>
            {text(LANDING.footer.pricing, locale)}
          </a>
          <a href={`mailto:${contactEmail}`}>{text(LANDING.footer.contact, locale)}</a>
        </nav>

        <div className="landing__foot-meta">
          <p>
            © {year} MengYin Study. {text(LANDING.footer.independent, locale)}
          </p>
          <p>{text(LANDING.footer.trademark, locale)}</p>
        </div>
      </footer>
    </div>
  );
}
