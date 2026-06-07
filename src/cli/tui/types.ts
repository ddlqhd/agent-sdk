export interface ChatLine {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
}

export type TuiModal = 'none' | 'help' | 'sessions' | 'checkpoints';
