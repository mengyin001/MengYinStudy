import { useEffect, useMemo } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { browserLegalContext } from '@/legal/config';
import { LEGAL_CHROME, LEGAL_DOCS } from '@/legal/content';
import { pick, resolveDoc, type ResolvedDoc } from '@/legal/render';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import '@/styles/legal.css';

/**
 * The Privacy Policy and the Terms of Service as an in-app page.
 *
 * Deliberately outside the app shell: a reader following a link from a store
 * listing or from the sign-up screen should see the document, not a sidebar
 * full of features they cannot use yet.
 */
export function LegalPage({ docId }: { docId: 'privacy' | 'terms' }) {
  const { locale, actions } = useApp();
  const ctx = useMemo(() => browserLegalContext(), []);
  const doc = useMemo<ResolvedDoc>(
    () => resolveDoc(LEGAL_DOCS[docId], locale, ctx),
    [docId, locale, ctx],
  );

  useEffect(() => {
    document.title = `${doc.title} · MengYin Study`;
  }, [doc.title]);

  // The router keeps the scroll position across hash changes. Arriving here
  // from a scrolled Settings page would otherwise drop the reader in the
  // middle of section 7, so every document starts at its own top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [docId]);

  const sibling = docId === 'privacy' ? LEGAL_DOCS.terms : LEGAL_DOCS.privacy;
  const siblingHref = docId === 'privacy' ? '#/terms' : '#/privacy';

  return (
    <div className="legal-page">
      <header className="legal-top">
        <a
          className="legal-brand"
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <BrandMark className="legal-brand__mark" />
          MengYin Study
        </a>
        <div className="legal-top__actions">
          <div className="legal-lang" role="group" aria-label={pick(LEGAL_CHROME.language, locale)}>
            <button
              type="button"
              className={`legal-lang__btn ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => actions.updateSettings({ locale: 'en' })}
            >
              EN
            </button>
            <button
              type="button"
              className={`legal-lang__btn ${locale === 'zh-Hant' ? 'is-active' : ''}`}
              aria-pressed={locale === 'zh-Hant'}
              onClick={() => actions.updateSettings({ locale: 'zh-Hant' })}
            >
              繁中
            </button>
          </div>
          <a
            className="legal-back"
            href="#/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            {pick(LEGAL_CHROME.back, locale)}
          </a>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-doc">
          <header className="legal-doc__head">
            <p className="legal-eyebrow">MengYin Study</p>
            <h1>{doc.title}</h1>
            <p className="legal-summary">{doc.summary}</p>
            <p className="legal-meta">
              {pick(LEGAL_CHROME.updated, locale)} {doc.updated} ·{' '}
              {pick(LEGAL_CHROME.version, locale)} {doc.version}
            </p>
          </header>

          <nav className="legal-toc" aria-label={pick(LEGAL_CHROME.contents, locale)}>
            <p className="legal-toc__title">{pick(LEGAL_CHROME.contents, locale)}</p>
            <ol>
              {doc.sections.map((section, index) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => {
                      document
                        .getElementById(`legal-${doc.slug}-${section.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    <span className="legal-toc__num">{String(index + 1).padStart(2, '0')}</span>
                    {section.heading}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {doc.sections.map((section, index) => (
            <section
              key={section.id}
              id={`legal-${doc.slug}-${section.id}`}
              className="legal-section"
            >
              <h2>
                <span className="legal-section__num">{String(index + 1).padStart(2, '0')}</span>
                {section.heading}
              </h2>
              {section.blocks.map((block, blockIndex) => {
                switch (block.kind) {
                  case 'p':
                    return <p key={blockIndex}>{block.text}</p>;
                  case 'note':
                    return (
                      <p key={blockIndex} className="legal-note">
                        {block.text}
                      </p>
                    );
                  case 'ul':
                    return (
                      <ul key={blockIndex}>
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ul>
                    );
                  case 'ol':
                    return (
                      <ol key={blockIndex}>
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ol>
                    );
                  case 'table':
                    return (
                      <div className="legal-scroll" key={blockIndex}>
                        <table>
                          <thead>
                            <tr>
                              {block.head.map((cell, cellIndex) => (
                                <th key={cellIndex}>{cell}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {block.rows.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {row.map((cell, cellIndex) => (
                                  <td
                                    key={cellIndex}
                                    data-label={block.head[cellIndex] ?? ''}
                                    className={cellIndex === 0 ? 'is-key' : undefined}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  case 'links':
                    return (
                      <ul className="legal-links" key={blockIndex}>
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            <a href={item.href} rel="noreferrer noopener">
                              {item.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    );
                }
              })}
            </section>
          ))}

          <footer className="legal-doc__foot">
            <p>{doc.footerNote}</p>
            <p>
              <a
                href={siblingHref}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(siblingHref.replace('#', ''));
                }}
              >
                {pick(sibling.title, locale)}
              </a>
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}
