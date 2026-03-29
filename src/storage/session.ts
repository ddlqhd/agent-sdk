import { randomUUID } from 'node:crypto';
import type { StorageAdapter, Message, SessionInfo, StorageConfig } from '../core/types.js';
import { createStorage } from './interface.js';

/**
 * 会话管理器配置
 */
export interface SessionManagerConfig extends StorageConfig {
  /** 存储路径 */
  basePath?: string;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private storage: StorageAdapter;
  private currentSessionId: string | null = null;

  constructor(config?: SessionManagerConfig) {
    this.storage = createStorage(config);
  }

  /**
   * 获取当前会话 ID
   */
  get sessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 创建新会话
   */
  createSession(sessionId?: string): string {
    this.currentSessionId = sessionId || randomUUID();
    return this.currentSessionId;
  }

  /**
   * 恢复会话
   */
  async resumeSession(sessionId: string): Promise<Message[]> {
    const exists = await this.storage.exists(sessionId);
    if (!exists) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    this.currentSessionId = sessionId;
    return this.storage.load(sessionId);
  }

  /**
   * 保存消息到当前会话
   */
  async saveMessages(messages: Message[]): Promise<void> {
    if (!this.currentSessionId) {
      this.createSession();
    }

    await this.storage.save(this.currentSessionId!, messages);
  }

  /**
   * 加载当前会话消息
   */
  async loadMessages(): Promise<Message[]> {
    if (!this.currentSessionId) {
      return [];
    }

    return this.storage.load(this.currentSessionId);
  }

  /**
   * 追加消息
   */
  async appendMessage(message: Message): Promise<void> {
    if (!this.currentSessionId) {
      this.createSession();
    }

    const messages = await this.loadMessages();
    messages.push(message);
    await this.saveMessages(messages);
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<SessionInfo[]> {
    return this.storage.list();
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.delete(sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /**
   * 检查会话是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this.storage.exists(sessionId);
  }

  /**
   * 获取会话信息
   */
  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    const sessions = await this.storage.list();
    return sessions.find(s => s.id === sessionId) || null;
  }

  /**
   * 清空当前会话
   */
  async clearCurrentSession(): Promise<void> {
    if (this.currentSessionId) {
      await this.storage.delete(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  /**
   * 获取底层存储适配器
   */
  getStorage(): StorageAdapter {
    return this.storage;
  }
}

/**
 * 创建会话管理器
 */
export function createSessionManager(config?: StorageConfig): SessionManager {
  return new SessionManager(config);
}
