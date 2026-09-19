import type { AskUserQuestionResolver, StreamEvent } from '@ddlqhd/agent-sdk';

/**
 * Protocol adapter sink for a single turn. Kernel does not format UI events.
 */
export interface TurnSink {
  onEvent(event: StreamEvent): void | Promise<void>;
  resetTurn?(): void;
}

/**
 * Optional tool-approval port. ACP implements requestPermission; CLI/Web usually omit this.
 */
export type CanUseToolPort = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<boolean>;

/**
 * AskUserQuestion port. CLI uses TTY; Web uses WS; ACP disables the tool.
 */
export type InteractionPort = AskUserQuestionResolver;
