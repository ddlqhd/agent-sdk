import { marked, Renderer, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

const DANGEROUS_PROTOCOL = /^(javascript|data|vbscript):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Drops `javascript:` / `data:` / `vbscript:` hrefs. Relative paths, hashes,
 * http(s), mailto, and tel are kept.
 */
export function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return '';
  if (DANGEROUS_PROTOCOL.test(trimmed)) return '';
  if (SAFE_SCHEME.test(trimmed) || trimmed.startsWith('#') || trimmed.startsWith('/')) {
    return trimmed;
  }
  if (!HAS_SCHEME.test(trimmed)) return trimmed;
  return '';
}

const renderer = new Renderer();

renderer.link = function ({ href, title, tokens }: Tokens.Link): string {
  const body = this.parser.parseInline(tokens);
  const safe = sanitizeHref(href);
  if (!safe) return body;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer">${body}</a>`;
};

renderer.image = ({ href, title, text }: Tokens.Image): string => {
  const safe = sanitizeHref(href);
  if (!safe) return escapeHtml(text);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttr} />`;
};

renderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escapeHtml(text);

marked.use({
  gfm: true,
  breaks: true,
  renderer
});

/** Parse markdown to HTML without DOM sanitization (usable in Node tests). */
export function parseMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}

function decorateLinks(root: ParentNode): void {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    const safe = sanitizeHref(href);
    if (!safe) {
      anchor.replaceWith(document.createTextNode(anchor.textContent ?? ''));
      return;
    }
    anchor.setAttribute('href', safe);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });
}

/**
 * Render model markdown into a chat body element. HTML is sanitized before insert.
 */
export function renderMarkdownInto(el: HTMLElement, source: string): void {
  const raw = parseMarkdown(source);
  if (typeof window === 'undefined') {
    el.textContent = source;
    return;
  }
  el.innerHTML = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  });
  decorateLinks(el);
}
