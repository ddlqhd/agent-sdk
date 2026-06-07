import { Command } from 'commander';
import chalk from 'chalk';
import { SessionManager, isRewindEntry } from '../../storage/session.js';
import { formatTable } from '../utils/output.js';
import { getSessionStoragePath } from '../../storage/session-path.js';
import type {
  Message,
  RewindToCheckpointOptions,
  SummaryEntry
} from '../../core/types.js';

function addUserBasePathOption(cmd: Command): Command {
  return cmd.option('--user-base-path <path>', 'User base path (default: ~), must match chat/run');
}

function createCliSessionManager(userBasePath?: string): SessionManager {
  return new SessionManager({
    type: 'jsonl',
    basePath: getSessionStoragePath(userBasePath)
  });
}

function formatMessageContent(content: Message['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function parseRewindCheckpointOptions(options: {
  checkpointId?: string;
  userTurnIndex?: number;
  keepThroughRawIndex?: number;
}): RewindToCheckpointOptions {
  const count = [options.checkpointId, options.userTurnIndex, options.keepThroughRawIndex].filter(
    (v) => v !== undefined
  ).length;
  if (count !== 1) {
    console.error(
      chalk.red('Specify exactly one of: --checkpoint-id, --user-turn-index, --keep-through-raw-index')
    );
    process.exit(1);
  }
  if (options.checkpointId !== undefined) {
    return { checkpointId: options.checkpointId };
  }
  if (options.userTurnIndex !== undefined) {
    return { userTurnIndex: options.userTurnIndex };
  }
  return { keepThroughRawIndex: options.keepThroughRawIndex! };
}

async function ensureSessionExists(manager: SessionManager, id: string): Promise<void> {
  const exists = await manager.sessionExists(id);
  if (!exists) {
    console.error(chalk.red(`Session "${id}" not found`));
    process.exit(1);
  }
}

/**
 * 会话管理命令
 */
export function createSessionsCommand(): Command {
  const command = new Command('sessions').description('Manage chat sessions');

  // 列出会话
  addUserBasePathOption(
    command
      .command('list')
      .description('List all sessions')
      .option('-l, --limit <n>', 'Limit number of sessions', parseInt, 20)
      .option('-f, --format <format>', 'Output format (table/json)', 'table')
  ).action(async (options) => {
    const manager = createCliSessionManager(options.userBasePath);
    const sessions = await manager.listSessions();

    const limited = sessions.slice(0, options.limit);

    if (options.format === 'json') {
      console.log(JSON.stringify(limited, null, 2));
    } else {
      if (limited.length === 0) {
        console.log(chalk.gray('No sessions found'));
        return;
      }

      console.log(chalk.cyan('\n💬 Sessions\n'));
      console.log(
        formatTable(
          limited.map((s) => ({
            id: s.id,
            messages: s.messageCount,
            created: new Date(s.createdAt).toLocaleString(),
            updated: new Date(s.updatedAt).toLocaleString()
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'messages', header: 'Entries', width: 10 },
            { key: 'created', header: 'Created', width: 20 },
            { key: 'updated', header: 'Updated', width: 20 }
          ]
        )
      );
      console.log(chalk.gray(`\nTotal: ${sessions.length} sessions`));
      console.log(
        chalk.gray('Note: Entries = raw JSONL line count (includes summary/rewind), not active messages.')
      );
    }
  });

  // 查看会话详情
  addUserBasePathOption(
    command
      .command('show <id>')
      .description('Show session messages (active chain after last compaction by default)')
      .option('-l, --limit <n>', 'Limit number of messages', parseInt, 50)
      .option('--raw', 'Full append-only transcript including pre-compaction history')
  ).action(async (id, options) => {
    const manager = createCliSessionManager(options.userBasePath);
    await ensureSessionExists(manager, id);
    await manager.attachSession(id);

    let display: Array<{ role: string; content: string; extra?: string }> = [];

    if (options.raw) {
      const raw = await manager.loadRawEntries();
      for (const e of raw) {
        if ((e as SummaryEntry).$type === 'summary') {
          const s = e as SummaryEntry;
          display.push({
            role: 'summary',
            content: s.text.slice(0, 500) + (s.text.length > 500 ? '…' : ''),
            extra: `mode=${s.summaryMode} original=${s.stats.originalMessageCount} compressed=${s.stats.compressedMessageCount} @ ${new Date(s.timestamp).toISOString()}`
          });
        } else if (isRewindEntry(e)) {
          display.push({
            role: 'rewind',
            content: `keepThroughRawIndex=${e.keepThroughRawIndex}`,
            extra: `@ ${new Date(e.timestamp).toISOString()}`
          });
        } else {
          const m = e as Message;
          if (m.role === 'system') {
            continue;
          }
          display.push({ role: m.role, content: formatMessageContent(m.content) });
        }
      }
    } else {
      const messages = await manager.loadActiveMessages();
      display = messages.map((m) => ({
        role: m.role,
        content: formatMessageContent(m.content)
      }));
    }

    const limited = display.slice(-options.limit);

    console.log(chalk.cyan(`\n💬 Session: ${id}${options.raw ? ' (raw)' : ''}\n`));
    console.log(chalk.gray(`Showing ${limited.length} of ${display.length} entries\n`));

    for (const row of limited) {
      const role =
        row.role === 'user'
          ? chalk.green('You')
          : row.role === 'assistant'
            ? chalk.blue('Assistant')
            : row.role === 'summary'
              ? chalk.magenta('Compaction')
              : row.role === 'rewind'
                ? chalk.magenta('Rewind')
                : chalk.yellow(row.role);

      const extra = row.extra ? chalk.gray(` (${row.extra})`) : '';
      console.log(`${role}${extra}: ${row.content}\n`);
    }
  });

  // 列出 checkpoint
  addUserBasePathOption(
    command
      .command('checkpoints <id>')
      .description('List rewind checkpoints (all user prompts in raw transcript)')
      .option('-f, --format <format>', 'Output format (table/json)', 'table')
  ).action(async (id, options) => {
    const manager = createCliSessionManager(options.userBasePath);
    await ensureSessionExists(manager, id);
    await manager.attachSession(id);
    const checkpoints = await manager.listSessionCheckpoints();

    if (options.format === 'json') {
      console.log(JSON.stringify(checkpoints, null, 2));
      return;
    }

    if (checkpoints.length === 0) {
      console.log(chalk.gray('No checkpoints found'));
      return;
    }

    console.log(chalk.cyan(`\n📍 Checkpoints for session ${id}\n`));
    console.log(chalk.gray('userTurnIndex is 0-based (use with sessions rewind --user-turn-index)\n'));
    console.log(
      formatTable(
        checkpoints.map((c) => ({
          index: c.userTurnIndex,
          preview: c.preview,
          summariesAfter: c.summariesAfter ?? 0,
          checkpointId: c.checkpointId
        })),
        [
          { key: 'index', header: 'Turn', width: 6 },
          { key: 'preview', header: 'Preview', width: 40 },
          { key: 'summariesAfter', header: 'Summaries', width: 10 },
          { key: 'checkpointId', header: 'Checkpoint ID', width: 48 }
        ]
      )
    );
  });

  // 回退会话
  addUserBasePathOption(
    command
      .command('rewind <id>')
      .description('Rewind session on disk (does not sync in-memory Agent in other processes)')
      .option('--checkpoint-id <id>', 'Checkpoint id from sessions checkpoints')
      .option('--user-turn-index <n>', '0-based user prompt index', parseInt)
      .option('--keep-through-raw-index <n>', 'Raw JSONL line index (must be user row)', parseInt)
      .option('-f, --format <format>', 'Output format (table/json)', 'table')
  ).action(async (id, options) => {
    const manager = createCliSessionManager(options.userBasePath);
    await ensureSessionExists(manager, id);
    await manager.attachSession(id);

    const rewindOpts = parseRewindCheckpointOptions(options);
    const result = await manager.rewindToCheckpoint(rewindOpts);

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.green(`✓ Session "${id}" rewound`));
      console.log(chalk.gray(`  keepThroughRawIndex: ${result.keepThroughRawIndex}`));
      console.log(chalk.gray(`  kept messages: ${result.keptMessageCount}`));
      console.log(chalk.gray(`  dropped messages: ${result.droppedMessageCount}`));
      console.log(
        chalk.yellow(
          '\nNote: This updates JSONL only. Running chat/web-demo agents keep their in-memory state until rewind via Agent API.'
        )
      );
    }
  });

  // 分支会话
  addUserBasePathOption(
    command
      .command('fork <sourceId>')
      .description('Fork session to a new id (source unchanged)')
      .option('--new-id <id>', 'New session id (default: random UUID)')
      .option('--checkpoint-id <id>', 'Fork prefix through checkpoint')
      .option('--user-turn-index <n>', 'Fork prefix through 0-based user turn', parseInt)
      .option('--keep-through-raw-index <n>', 'Fork prefix through raw user row index', parseInt)
      .option('-f, --format <format>', 'Output format (table/json)', 'table')
  ).action(async (sourceId, options) => {
    const manager = createCliSessionManager(options.userBasePath);
    await ensureSessionExists(manager, sourceId);

    const forkOpts: {
      newSessionId?: string;
      checkpointId?: string;
      userTurnIndex?: number;
      throughRawIndex?: number;
    } = {};
    if (options.newId) forkOpts.newSessionId = options.newId;

    const cpCount = [options.checkpointId, options.userTurnIndex, options.keepThroughRawIndex].filter(
      (v) => v !== undefined
    ).length;
    if (cpCount > 1) {
      console.error(
        chalk.red('Specify at most one of: --checkpoint-id, --user-turn-index, --keep-through-raw-index')
      );
      process.exit(1);
    }
    if (options.checkpointId) forkOpts.checkpointId = options.checkpointId;
    if (options.userTurnIndex !== undefined) forkOpts.userTurnIndex = options.userTurnIndex;
    if (options.keepThroughRawIndex !== undefined) {
      forkOpts.throughRawIndex = options.keepThroughRawIndex;
    }

    const result = await manager.forkSession(sourceId, forkOpts);

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.green(`✓ Forked session`));
      console.log(chalk.gray(`  source: ${result.sourceSessionId}`));
      console.log(chalk.gray(`  new:    ${result.sessionId}`));
      console.log(chalk.gray(`  messages copied: ${result.messageCount}`));
    }
  });

  // 删除会话
  addUserBasePathOption(
    command
      .command('delete <id>')
      .description('Delete a session')
      .option('-f, --force', 'Skip confirmation')
  ).action(async (id, options) => {
    const manager = createCliSessionManager(options.userBasePath);
    await ensureSessionExists(manager, id);

    if (!options.force) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow(`Delete session "${id}"? (y/N) `), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        return;
      }
    }

    await manager.deleteSession(id);
    console.log(chalk.green(`✓ Session "${id}" deleted`));
  });

  // 清空所有会话
  addUserBasePathOption(
    command
      .command('clear')
      .description('Delete all sessions')
      .option('-f, --force', 'Skip confirmation')
  ).action(async (options) => {
    const manager = createCliSessionManager(options.userBasePath);
    const sessions = await manager.listSessions();

    if (sessions.length === 0) {
      console.log(chalk.gray('No sessions to clear'));
      return;
    }

    if (!options.force) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow(`Delete all ${sessions.length} sessions? (y/N) `), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        return;
      }
    }

    const storage = manager.getStorage();
    for (const session of sessions) {
      await storage.delete(session.id);
    }

    console.log(chalk.green(`✓ Deleted ${sessions.length} sessions`));
  });

  return command;
}
