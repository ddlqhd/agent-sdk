import { formatTable } from './output.js';

export interface SlashCommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: 'List slash commands' },
  { name: 'status', description: 'Session stats (model, tokens, checkpoints)' },
  { name: 'session', aliases: ['info'], description: 'Short session summary' },
  { name: 'sessions', aliases: ['resume', 'continue'], description: 'Pick and switch session' },
  { name: 'new', aliases: ['clear'], description: 'Start a new session (UI only)' },
  { name: 'checkpoints', description: 'List rewind checkpoints' },
  { name: 'rewind', usage: '/rewind <n>', description: 'Rewind to 0-based user turn' },
  { name: 'fork', usage: '/fork [n]', description: 'Fork session (optional checkpoint turn)' },
  { name: 'details', description: 'Toggle verbose tool output' },
  { name: 'compact', aliases: ['summarize'], description: 'Compress context (LLM)' },
  { name: 'export', usage: '/export [path]', description: 'Export active history to Markdown' },
  { name: 'editor', aliases: ['e'], description: 'Compose message in $EDITOR' },
  { name: 'exit', aliases: ['quit', 'q'], description: 'End chat session' }
];

const aliasToName = new Map<string, string>();
for (const cmd of SLASH_COMMANDS) {
  aliasToName.set(cmd.name.toLowerCase(), cmd.name);
  for (const a of cmd.aliases ?? []) {
    aliasToName.set(a.toLowerCase(), cmd.name);
  }
}

export function resolveSlashCommandName(input: string): string | undefined {
  return aliasToName.get(input.toLowerCase());
}

export function matchSlashCommandsByPrefix(prefix: string): SlashCommandDef[] {
  const p = prefix.toLowerCase();
  if (!p) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) =>
      c.name.startsWith(p) ||
      (c.aliases?.some((a) => a.startsWith(p)) ?? false)
  );
}

export function printSlashHelpTable(): void {
  console.log(
    formatTable(
      SLASH_COMMANDS.map((c) => ({
        command: `/${c.name}`,
        aliases: c.aliases?.map((a) => `/${a}`).join(', ') ?? '',
        description: c.description,
        usage: c.usage ?? `/${c.name}`
      })),
      [
        { key: 'command', header: 'Command', width: 14 },
        { key: 'aliases', header: 'Aliases', width: 18 },
        { key: 'usage', header: 'Usage', width: 20 },
        { key: 'description', header: 'Description', width: 36 }
      ]
    )
  );
}
