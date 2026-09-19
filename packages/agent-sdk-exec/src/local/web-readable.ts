import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

/**
 * Convert HTML to markdown via Readability + Turndown. If Readability yields nothing, falls back to body HTML.
 */
export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();
  let htmlContent = article?.content?.trim() ?? '';
  if (!htmlContent && document.body) {
    htmlContent = document.body.innerHTML ?? '';
  }
  if (!htmlContent) {
    return '';
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  return turndown.turndown(htmlContent).trim();
}

function htmlToMarkdownOrRaw(html: string): string {
  try {
    const converted = htmlToMarkdown(html);
    return converted || html;
  } catch {
    return html;
  }
}

export function formatJsonText(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    return JSON.stringify(v, null, 2);
  } catch {
    return raw;
  }
}

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[Output truncated to ${maxChars} characters]`;
}

export function primaryMimeType(contentType: string | null): string {
  if (!contentType) {
    return '';
  }
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Default cap on readable WebFetch text after conversion. */
export const WEB_FETCH_MAX_OUTPUT_CHARS = 512_000;

/**
 * Turn a raw HTTP body into markdown / formatted JSON / plain text.
 */
export function toReadableContent(body: string, mimeType: string, maxOutputChars = WEB_FETCH_MAX_OUTPUT_CHARS): string {
  const mime = mimeType || '';
  let content: string;
  if (mime.includes('html') || mime === 'application/xhtml+xml') {
    content = htmlToMarkdownOrRaw(body);
  } else if (mime.includes('json') || mime.endsWith('+json')) {
    content = formatJsonText(body);
  } else {
    content = body;
  }
  return truncateOutput(content, maxOutputChars);
}
