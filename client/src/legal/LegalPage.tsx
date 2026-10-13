import { useEffect, type ReactNode } from 'react';
import { GlobalNav } from '../components/GlobalNav';
import type { AppMode } from '../types';
import { supportEmailAddress } from './legalConfig.mjs';
import type { LegalBlock, LegalDocument } from './legalContent.mjs';
import { LegalLinks } from './LegalLinks';
import type { LegalMode } from './legalModes';
import './legalPage.css';

export interface LegalPageProps {
  document: LegalDocument;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

/** Once the owner sets a real support address, it becomes a mailto link wherever it appears. */
function withEmailLinks(text: string): ReactNode {
  const email = supportEmailAddress();
  if (!email || !text.includes(email)) return text;
  const parts = text.split(email);
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <a key={index} href={`mailto:${email}`}>
            {email}
          </a>,
          part,
        ],
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (Array.isArray(block)) {
    return (
      <ul>
        {block.map((item) => (
          <li key={item}>{withEmailLinks(item)}</li>
        ))}
      </ul>
    );
  }
  return <p>{withEmailLinks(block)}</p>;
}

/**
 * Privacy Policy, Terms of Use and Support: one long-form reading page.
 *
 * The Settings / How to Play pattern: `.app` is `100dvh; overflow: hidden`, the
 * nav is pinned, and one scrollport underneath carries the document. Renders
 * the same data scripts/prerender.mjs serves, so it works signed out and with
 * no session at all.
 */
export function LegalPage({ document: doc, onNavigate, onOpenAuth, onSignOut }: LegalPageProps) {
  useEffect(() => {
    // Direct loads get their <title> from the prerendered HTML; in-app
    // navigation has to set it, and put the previous one back on the way out.
    const previous = window.document.title;
    window.document.title = `${doc.title} | Racehorse Dominoes`;
    return () => {
      window.document.title = previous;
    };
  }, [doc.title]);

  const navigateLegal = onNavigate ? (mode: LegalMode) => onNavigate(mode) : undefined;

  return (
    <div className={`rh-legal-page rh-legal-page--${doc.id}`}>
      <GlobalNav
        currentMode={doc.id}
        activeColor="var(--accent-steel)"
        solidDarkChrome
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onSignOut={onSignOut}
      />
      <div className="rh-legal-scroll">
        <article className="rh-legal">
          <header className="rh-legal-head">
            <p className="rh-legal-eyebrow">{doc.eyebrow}</p>
            <h1 className="rh-legal-title">{doc.title}</h1>
            {doc.effective && <p className="rh-legal-effective">{doc.effective}</p>}
            <p className="rh-legal-standfirst">{doc.standfirst}</p>
          </header>

          {doc.sections.length > 4 && (
            <nav className="rh-legal-toc" aria-label="On this page">
              <ul>
                {doc.sections.map((section) => (
                  <li key={section.id}>
                    {/* Scrolled in place rather than followed: a fragment
                        navigation fires popstate, which the route sync reads
                        as a back/forward and would stop recording the next
                        in-app navigation. */}
                    <a
                      href={`#${section.id}`}
                      onClick={(event) => {
                        const target = window.document.getElementById(section.id);
                        if (!target) return;
                        event.preventDefault();
                        target.scrollIntoView({ block: 'start' });
                      }}
                    >
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="rh-legal-section" aria-labelledby={`${section.id}-heading`}>
              <h2 id={`${section.id}-heading`}>{section.heading}</h2>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}

          <footer className="rh-legal-foot">
            <LegalLinks current={doc.id} onNavigate={navigateLegal} />
          </footer>
        </article>
      </div>
    </div>
  );
}

export default LegalPage;
