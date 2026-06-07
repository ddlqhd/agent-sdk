import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Agent } from '../../core/agent.js';
import { formatTable } from './output.js';
import { ensureChatSessionAttached } from './agent-bootstrap.js';
import { messagesToTerminalLines } from './chat-history.js';
import {
  matchSlashCommandsByPrefix,
  printSlashHelpTable,
  resolveSlashCommandName
} from './slash-registry.js';
import { listSessionsForPicker, type SessionPickerItem } from './session-cli.js';
import { collectSessionStatus } from './session-status.js';

export type SlashResult =
  | { handled: false }
  | {
      handled: true;
      sessionId?: string;
      replayHistory?: boolean;
      newSession?: boolean;
      verbose?: boolean;
      pendingUserInput?: string;
      exit?: boolean;
    };

export interface SlashContext {
  sessionId?: string;
  verbose: boolean;
  userBasePath?: string;
  cwd: string;
  askLine: (prompt: string) => Promise<string>;
  onReplay: (opts?: { verbose?: boolean }) => Promise<void>;
}

function parseSlashInput(input: string): { cmd: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const raw = parts[0]!.slice(1);
  const resolved = resolveSlashCommandName(raw);
  if (!resolved) {
    return { cmd: raw.toLowerCase(), args: parts.slice(1).join(' ').trim() };
  }
  return { cmd: resolved, args: parts.slice(1).join(' ').trim() };
}

export function suggestSlashCommands(partial: string): void {
  const trimmed = partial.trim();
  if (!trimmed.startsWith('/')) return;
  const prefix = trimmed.slice(1).split(/\s+/)[0] ?? '';
  if (!prefix || prefix.includes(' ')) return;
  const matches = matchSlashCommandsByPrefix(prefix);
  if (matches.length === 0 || (matches.length === 1 && matches[0]!.name === prefix)) return;
  console.log(chalk.gray(`Matching: ${matches.map((m) => `/${m.name}`).join(', ')}`));
}

async function printStatus(
  agent: Agent,
  sessionId: string | undefined,
  brief: boolean,
  verbose: boolean,
  cwd: string
): Promise<void> {
  const snap = await collectSessionStatus(agent, {
    sessionId,
    verbose,
    streaming: false,
    cwd
  });

  if (brief) {
    console.log(chalk.cyan(`Session: ${snap.sessionId ?? '(none)'}`));
    console.log(chalk.gray(`Model: ${snap.modelName}  Messages: ${snap.activeMessageCount}`));
    return;
  }

  console.log(chalk.cyan('\nSession status\n'));
  console.log(chalk.gray(`  session:     ${snap.sessionId ?? '(none — next message creates one)'}`));
  console.log(chalk.gray(`  model:       ${snap.modelName}`));
  console.log(chalk.gray(`  messages:    ${snap.activeMessageCount} active`));
  console.log(chalk.gray(`  checkpoints: ${snap.checkpointCount}`));
  console.log(
    chalk.gray(
      `  tokens:      in=${snap.usage.inputTokens} out=${snap.usage.outputTokens} total=${snap.usage.totalTokens}`
    )
  );
  if (snap.context) {
    console.log(
      chalk.gray(
        `  context:     used=${snap.context.used} usable=${snap.context.usable} compressions=${snap.context.compressCount}`
      )
    );
  } else {
    console.log(chalk.gray('  context:     disabled'));
  }
  if (snap.lastUserPreview) console.log(chalk.gray(`  last user:   ${snap.lastUserPreview}`));
  if (snap.lastAssistantPreview) console.log(chalk.gray(`  last reply:  ${snap.lastAssistantPreview}`));
  console.log('');
}

async function runSessionsPicker(
  agent: Agent,
  ctx: SlashContext
): Promise<{ sessionId?: string; replayHistory?: boolean }> {
  const items = await listSessionsForPicker(ctx.userBasePath, 20);
  if (items.length === 0) {
    console.log(chalk.gray('No saved sessions.'));
    return {};
  }

  console.log(chalk.cyan('\nSessions (most recent first)\n'));
  printSessionPickerTable(items);
  const answer = (await ctx.askLine(chalk.yellow('Enter number, session id prefix, or filter: '))).trim();
  if (!answer) return {};

  const selected = resolvePickerSelection(items, answer);
  if (!selected) {
    console.log(chalk.red('No matching session.'));
    return {};
  }

  await ensureChatSessionAttached(agent, selected.id);
  console.log(chalk.green(`Switched to ${selected.id}`));
  return { sessionId: selected.id, replayHistory: true };
}

function printSessionPickerTable(items: SessionPickerItem[]): void {
  console.log(
    formatTable(
      items.map((s, i) => ({
        n: i + 1,
        id: s.id.slice(0, 8) + '…',
        entries: s.messageCount,
        preview: s.preview ?? '',
        updated: new Date(s.updatedAt).toLocaleString()
      })),
      [
        { key: 'n', header: '#', width: 4 },
        { key: 'id', header: 'ID', width: 12 },
        { key: 'entries', header: 'Entries', width: 8 },
        { key: 'updated', header: 'Updated', width: 20 },
        { key: 'preview', header: 'Preview', width: 40 }
      ]
    )
  );
}

export function resolvePickerSelection(
  items: SessionPickerItem[],
  answer: string
): SessionPickerItem | undefined {
  const n = Number.parseInt(answer, 10);
  if (Number.isInteger(n) && n >= 1 && n <= items.length) {
    return items[n - 1];
  }
  const lower = answer.toLowerCase();
  const byId = items.filter((s) => s.id.toLowerCase().startsWith(lower));
  if (byId.length === 1) return byId[0];
  const byPreview = items.filter((s) => s.preview?.toLowerCase().includes(lower));
  if (byPreview.length === 1) return byPreview[0];
  if (byId.length === 1) return byId[0];
  return undefined;
}

async function exportMarkdown(
  agent: Agent,
  sessionId: string | undefined,
  args: string
): Promise<void> {
  const sm = agent.getSessionManager();
  const sid = sessionId ?? sm.sessionId ?? 'session';
  if (sessionId) await ensureChatSessionAttached(agent, sessionId);
  const messages = await sm.loadActiveMessages();
  const lines = messagesToTerminalLines(messages, { verbose: true });
  const md = lines
    .map((l) => `## ${l.role}\n\n${l.text}\n`)
    .join('\n');
  const path = args.trim() || `./session-${sid}.md`;
  writeFileSync(path, `# Session ${sid}\n\n${md}`, 'utf-8');
  console.log(chalk.green(`Exported to ${path}`));
}

async function runEditor(ctx: SlashContext): Promise<string | undefined> {
  const editor = process.env.EDITOR;
  if (!editor) {
    console.log(chalk.red('EDITOR environment variable is not set.'));
    return undefined;
  }
  if (!process.stdin.isTTY) {
    console.log(chalk.red('/editor requires a TTY.'));
    return undefined;
  }
  const dir = mkdtempSync(join(tmpdir(), 'agent-sdk-editor-'));
  const file = join(dir, 'message.md');
  writeFileSync(file, '', 'utf-8');
  try {
    execSync(`${editor} "${file}"`, { stdio: 'inherit', cwd: ctx.cwd });
    const content = readFileSync(file, 'utf-8').trim();
    return content || undefined;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

export async function handleSlashCommand(
  agent: Agent,
  input: string,
  ctx: SlashContext
): Promise<SlashResult> {
  const parsed = parseSlashInput(input);
  if (!parsed) return { handled: false };

  const { cmd, args } = parsed;
  const known = resolveSlashCommandName(cmd) ?? cmd;

  if (!resolveSlashCommandName(cmd) && !SLASH_BUILTIN.has(known)) {
    return { handled: false };
  }

  let sessionId = ctx.sessionId;
  if (sessionId && known !== 'new') {
    await ensureChatSessionAttached(agent, sessionId);
  }

  switch (known) {
    case 'help':
      console.log(chalk.cyan('\nSlash commands\n'));
      printSlashHelpTable();
      console.log(chalk.gray('\nAlso: !cmd runs shell; /skill-name invokes skills; exit or /exit to quit.\n'));
      return { handled: true, sessionId };

    case 'status':
      await printStatus(agent, sessionId, false, ctx.verbose, ctx.cwd);
      return { handled: true, sessionId };

    case 'session':
      await printStatus(agent, sessionId, true, ctx.verbose, ctx.cwd);
      return { handled: true, sessionId };

    case 'sessions': {
      const picked = await runSessionsPicker(agent, ctx);
      return { handled: true, sessionId: picked.sessionId ?? sessionId, replayHistory: picked.replayHistory };
    }

    case 'new': {
      agent.clearMessages();
      const newId = agent.getSessionManager().createSession(randomUUID());
      console.log(chalk.green(`New session: ${newId}`));
      return { handled: true, sessionId: newId, replayHistory: true, newSession: true };
    }

    case 'checkpoints': {
      const checkpoints = await agent.listSessionCheckpoints();
      if (checkpoints.length === 0) {
        console.log(chalk.gray('No checkpoints (attach a session with messages first).'));
      } else {
        console.log(chalk.cyan('\nCheckpoints (userTurnIndex is 0-based):\n'));
        console.log(
          formatTable(
            checkpoints.map((c) => ({
              turn: c.userTurnIndex,
              preview: c.preview,
              summariesAfter: c.summariesAfter ?? 0
            })),
            [
              { key: 'turn', header: 'Turn', width: 6 },
              { key: 'preview', header: 'Preview', width: 50 },
              { key: 'summariesAfter', header: 'Summaries', width: 10 }
            ]
          )
        );
      }
      return { handled: true, sessionId };
    }

    case 'rewind': {
      if (!args) {
        console.log(chalk.yellow('Usage: /rewind <userTurnIndex>  (0-based, see /checkpoints)'));
        return { handled: true, sessionId };
      }
      const n = Number.parseInt(args, 10);
      if (!Number.isInteger(n) || n < 0) {
        console.log(chalk.red(`Invalid userTurnIndex: ${args}`));
        return { handled: true, sessionId };
      }
      const result = await agent.rewindToCheckpoint({ userTurnIndex: n });
      console.log(
        chalk.green(`Rewound: kept ${result.keptMessageCount}, dropped ${result.droppedMessageCount}`)
      );
      return { handled: true, sessionId, replayHistory: true };
    }

    case 'fork': {
      if (!sessionId && !agent.getSessionManager().sessionId) {
        console.log(chalk.yellow('No session attached. Send a message first or use /sessions.'));
        return { handled: true, sessionId };
      }
      const forkOpts: { switchToForked: true; userTurnIndex?: number } = { switchToForked: true };
      if (args) {
        const n = Number.parseInt(args, 10);
        if (!Number.isInteger(n) || n < 0) {
          console.log(chalk.red(`Invalid userTurnIndex: ${args}`));
          return { handled: true, sessionId };
        }
        forkOpts.userTurnIndex = n;
      }
      const result = await agent.forkSession(sessionId, forkOpts);
      console.log(
        chalk.green(`Forked ${result.sourceSessionId} → ${result.sessionId} (${result.messageCount} messages)`)
      );
      return { handled: true, sessionId: result.sessionId, replayHistory: true };
    }

    case 'details': {
      const next = !ctx.verbose;
      console.log(chalk.gray(`Verbose tool output: ${next ? 'on' : 'off'} (applies next turn)`));
      return { handled: true, sessionId, verbose: next };
    }

    case 'compact': {
      if (agent.getContextStatus() === null) {
        console.log(chalk.yellow('Context management is disabled (AgentConfig.contextManagement: false).'));
        return { handled: true, sessionId };
      }
      try {
        const result = await agent.compressContext();
        console.log(
          chalk.green(
            `Compressed: ${result.stats.originalMessageCount} → ${result.stats.compressedMessageCount} messages`
          )
        );
        return { handled: true, sessionId, replayHistory: true };
      } catch (err) {
        console.log(chalk.red(`Compact failed: ${err instanceof Error ? err.message : err}`));
        return { handled: true, sessionId };
      }
    }

    case 'export':
      await exportMarkdown(agent, sessionId, args);
      return { handled: true, sessionId };

    case 'editor': {
      const text = await runEditor(ctx);
      if (!text) {
        console.log(chalk.gray('Editor produced empty content.'));
        return { handled: true, sessionId };
      }
      return { handled: true, sessionId, pendingUserInput: text };
    }

    case 'exit':
      return { handled: true, sessionId, exit: true };

    default:
      return { handled: false };
  }
}

const SLASH_BUILTIN = new Set([
  'help',
  'status',
  'session',
  'sessions',
  'new',
  'checkpoints',
  'rewind',
  'fork',
  'details',
  'compact',
  'export',
  'editor',
  'exit'
]);
