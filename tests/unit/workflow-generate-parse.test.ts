import { describe, it, expect } from 'vitest';
import { parseScriptDraft } from '../../src/workflow/parse-script-draft.js';

describe('parseScriptDraft', () => {
  it('parses JSON object with script field', () => {
    const draft = parseScriptDraft(
      JSON.stringify({
        script: "export const meta = { name: 'x', description: 'y' }\nreturn 1",
        rationale: 'simple'
      })
    );
    expect(draft.draft?.script).toContain('export const meta');
    expect(draft.draft?.rationale).toBe('simple');
  });

  it('parses JSON inside markdown fence', () => {
    const draft = parseScriptDraft(
      'Here is the result:\n```json\n' +
        JSON.stringify({
          script: "export const meta = { name: 'x', description: 'y' }\nreturn 1"
        }) +
        '\n```'
    );
    expect(draft.draft?.script).toContain('export const meta');
  });

  it('accepts raw workflow script without JSON wrapper', () => {
    const script = `export const meta = {
  name: 'compare',
  description: 'Compare approaches',
}

return await agent('hello')`;
    const draft = parseScriptDraft(script);
    expect(draft.draft?.script).toBe(script);
  });

  it('accepts workflow script inside js fence', () => {
    const script = `export const meta = { name: 'x', description: 'y' }
return 1`;
    const draft = parseScriptDraft('```javascript\n' + script + '\n```');
    expect(draft.draft?.script).toBe(script);
  });

  it('returns error for unrelated prose', () => {
    const draft = parseScriptDraft('I will write a workflow for you.');
    expect(draft.draft).toBeUndefined();
    expect(draft.error).toBeTruthy();
  });

  it('handles JSON with braces inside escaped script string', () => {
    const script = "export const meta = { name: 'x', description: 'y' }\nreturn { ok: true }";
    const draft = parseScriptDraft(JSON.stringify({ script, rationale: 'test' }));
    expect(draft.draft?.script).toBe(script);
  });
});
