import { Command } from 'commander';
import chalk from 'chalk';
import { SessionManager } from '../../storage/session.js';
import { formatTable } from '../utils/output.js';
import { getSessionStoragePath } from '../../storage/session-path.js';
import type { Message, SummaryEntry } from '../../core/types.js';

function addUserBasePathOption(cmd: Command): Command {
  return cmd.option('--user-base-path <path>', 'User base path (default: ~), must match chat/run');
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
    const manager = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(options.userBasePath)
    });
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
    const manager = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(options.userBasePath)
    });

    const exists = await manager.sessionExists(id);
    if (!exists) {
      console.error(chalk.red(`Session "${id}" not found`));
      process.exit(1);
    }

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
    console.log(
      chalk.gray(`Showing ${limited.length} of ${display.length} entries\n`)
    );

    for (const row of limited) {
      const role =
        row.role === 'user'
          ? chalk.green('You')
          : row.role === 'assistant'
            ? chalk.blue('Assistant')
            : row.role === 'summary'
              ? chalk.magenta('Compaction')
              : chalk.yellow(row.role);

      const extra = row.extra ? chalk.gray(` (${row.extra})`) : '';
      console.log(`${role}${extra}: ${row.content}\n`);
    }
  });

  // 删除会话
  addUserBasePathOption(
    command
      .command('delete <id>')
      .description('Delete a session')
      .option('-f, --force', 'Skip confirmation')
  ).action(async (id, options) => {
    const manager = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(options.userBasePath)
    });

    const exists = await manager.sessionExists(id);
    if (!exists) {
      console.error(chalk.red(`Session "${id}" not found`));
      process.exit(1);
    }

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
    const manager = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(options.userBasePath)
    });
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
