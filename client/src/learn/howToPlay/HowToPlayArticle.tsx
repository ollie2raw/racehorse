import { HOW_TO_PLAY_ARTICLE } from './howToPlayArticleContent.mjs';
import './howToPlayArticle.css';

/**
 * The written rules, below the interactive tutorial.
 *
 * Rendered from the same data the prerender script uses, so the served HTML
 * and the hydrated page say the same thing — a reader and a crawler get one
 * version of the rules, not two.
 */
export function HowToPlayArticle() {
  const { title, standfirst, sections } = HOW_TO_PLAY_ARTICLE;

  return (
    <article className="rh-htp-article">
      <h1 className="rh-htp-article__title">{title}</h1>
      <p className="rh-htp-article__standfirst">{standfirst}</p>

      <nav className="rh-htp-article__toc" aria-label="On this page">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.heading}</a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="rh-htp-article__section">
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

export default HowToPlayArticle;
