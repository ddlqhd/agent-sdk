import { describe, it, expect } from 'vitest';
import { parseMarkdown, sanitizeHref } from '../../packages/agent-sdk-cli/src/web/client/src/markdown.ts';

describe('web markdown', () => {
  it('renders headings, emphasis, lists, and inline code', () => {
    const html = parseMarkdown('## Title\n\n**bold** and `code`\n\n- a\n- b');
    expect(html).toContain('<h2>');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>');
  });

  it('renders fenced code blocks', () => {
    const html = parseMarkdown('```ts\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('const x = 1;');
  });

  it('renders GFM tables', () => {
    const html = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  it('opens links in a new tab and keeps nested emphasis', () => {
    const html = parseMarkdown('[**hi**](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<strong>hi</strong>');
  });

  it('treats single newlines as line breaks', () => {
    const html = parseMarkdown('line one\nline two');
    expect(html).toMatch(/<br\s*\/?>/i);
  });

  it('escapes raw HTML instead of executing it', () => {
    const html = parseMarkdown('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects javascript and data hrefs', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBe('');
    expect(sanitizeHref('data:text/html,x')).toBe('');
    expect(sanitizeHref('vbscript:msg')).toBe('');
    expect(sanitizeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeHref('#section')).toBe('#section');
    expect(sanitizeHref('/docs/x')).toBe('/docs/x');
    expect(sanitizeHref('mailto:a@b.com')).toBe('mailto:a@b.com');

    const html = parseMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('x');
  });
});
