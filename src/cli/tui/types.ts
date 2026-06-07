export interface ChatLine {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
  text: string;
}

export type TuiModal = 'none' | 'help' | 'sessions' | 'checkpoints' | 'status';
