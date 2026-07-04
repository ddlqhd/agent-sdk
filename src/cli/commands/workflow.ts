import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateWorkflow,
  runWorkflow,
  RUN_FINISHED,
  RUN_FAILED,
  PHASE_STARTED,
  AGENT_STARTED,
  AGENT_FINISHED,
  LOG
} from '../../workflow/index.js';
import type { CLIConfig } from '../types.js';
import { addModelOptions, modelConfigFromOptions } from '../utils/agent-bootstrap.js';

function printWorkflowEvents(events: Array<{ type: string; [key: string]: unknown }>): void {
  for (const ev of events) {
    if (ev.type === PHASE_STARTED) {
      console.log(chalk.cyan(`\n▶ Phase: ${String(ev.phase)}`));
    } else if (ev.type === AGENT_STARTED) {
      console.log(chalk.gray(`  agent start: ${String(ev.label ?? 'agent')} (${String(ev.phase ?? '')})`));
    } else if (ev.type === AGENT_FINISHED) {
      console.log(chalk.gray(`  agent done: ${String(ev.label ?? 'agent')}`));
    } else if (ev.type === LOG) {
      console.log(chalk.gray(`  log: ${String(ev.message)}`));
    } else if (ev.type === RUN_FAILED) {
      console.log(chalk.red(`Run failed: ${String(ev.error)}`));
    } else if (ev.type === RUN_FINISHED) {
      console.log(chalk.green(`\nRun finished (${String(ev.tokensSpent ?? 0)} tokens)`));
    }
  }
}

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Generate and run dynamic workflow scripts');

  const runCmd = addModelOptions(
    new Command('run')
      .description('Execute a workflow script file')
      .argument('<file>', 'Path to workflow .js file')
      .option('--args <json>', 'JSON args injected as `args` primitive')
      .option('--max-concurrency <n>', 'Max concurrent agent dispatches', (v) => parseInt(v, 10))
      .option('--max-agents <n>', 'Max total agent dispatches', (v) => parseInt(v, 10))
      .option('--budget <tokens>', 'Token budget ceiling', (v) => parseInt(v, 10))
      .option('--json', 'Print result as JSON')
  ).action(async (file: string, options: CLIConfig & {
    args?: string;
    maxConcurrency?: number;
    maxAgents?: number;
    budget?: number;
    json?: boolean;
  }) => {
    const path = resolve(process.cwd(), file);
    const source = readFileSync(path, 'utf8');
    let args: unknown = null;
    if (options.args) {
      args = JSON.parse(options.args);
    }

    const result = await runWorkflow(source, {
      filename: path,
      cwd: options.cwd ?? process.cwd(),
      args,
      modelConfig: modelConfigFromOptions(options),
      maxConcurrency: options.maxConcurrency,
      maxAgents: options.maxAgents,
      budget: options.budget ?? null
    });

    if (!options.json) {
      printWorkflowEvents(result.events);
      console.log('\nResult:');
      console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  });

  const genCmd = addModelOptions(
    new Command('generate')
      .description('Generate a workflow script from a task description')
      .argument('<task>', 'Natural language task description')
      .option('-o, --output <file>', 'Write generated script to file')
      .option('--json', 'Print full generate result as JSON')
  ).action(async (task: string, options: CLIConfig & { output?: string; json?: boolean }) => {
    const generated = await generateWorkflow(task, {
      modelConfig: modelConfigFromOptions(options),
      agentConfig: options.system ? { systemPrompt: options.system } : undefined
    });

    if (options.json) {
      console.log(JSON.stringify(generated, null, 2));
      return;
    }

    console.log(chalk.cyan(`Generated workflow: ${generated.meta.name}`));
    console.log(chalk.gray(`Description: ${generated.meta.description}`));
    console.log(chalk.gray(`Attempts: ${generated.attempts}`));
    if (generated.rationale) {
      console.log(chalk.gray(`Rationale: ${generated.rationale}`));
    }
    console.log('\n' + generated.script);

    if (options.output) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(resolve(process.cwd(), options.output), generated.script, 'utf8');
      console.log(chalk.green(`\nWrote ${options.output}`));
    }
  });

  cmd.addCommand(runCmd);
  cmd.addCommand(genCmd);
  return cmd;
}
