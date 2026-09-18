export type ToolLineKind = 'call' | 'result' | 'error';

export interface ChatLine {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
  text: string;
  toolKind?: ToolLineKind;
}

export type TuiModal = 'none' | 'help' | 'sessions' | 'checkpoints' | 'status';
