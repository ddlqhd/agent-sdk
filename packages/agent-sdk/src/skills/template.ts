import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Skill 模板处理上下文
 */
export interface SkillTemplateContext {
  /** Skill 所在目录 */
  skillDir: string;

  /** 当前会话 ID */
  sessionId?: string;

  /** 工作目录，默认 process.cwd() */
  cwd?: string;
}

/**
 * Skill 模板处理器
 * 处理 SKILL.md 中的变量替换和命令注入
 */
export class SkillTemplateProcessor {
  private context: SkillTemplateContext;

  constructor(context: SkillTemplateContext) {
    this.context = {
      cwd: process.cwd(),
      ...context
    };
  }

  /**
   * 处理模板内容
   * @param content SKILL.md 内容
   * @param args 用户传入的参数字符串
   * @returns 处理后的内容
   */
  async process(content: string, args: string): Promise<string> {
    let result = content;

    // 1. 处理 shell 命令注入 !`command`
    result = await this.processShellCommands(result);

    // 2. 处理变量替换
    result = this.processVariables(result, args);

    return result;
  }

  /**
   * 处理 shell 命令注入
   * 格式: !`command`
   * 命令在工作目录中执行，输出替换占位符
   */
  private async processShellCommands(content: string): Promise<string> {
    const shellCommandRegex = /!`([^`]+)`/g;
    const matches = [...content.matchAll(shellCommandRegex)];

    for (const match of matches) {
      const command = match[1];
      try {
        const { stdout } = await execAsync(command, {
          cwd: this.context.cwd,
          timeout: 30000
        });
        content = content.replace(match[0], stdout.trim());
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        content = content.replace(match[0], `[Error executing: ${command}\n${errorMsg}]`);
      }
    }

    return content;
  }

  /**
   * 处理变量替换
   */
  private processVariables(content: string, args: string): string {
    const argsArray = this.parseArguments(args);

    // $ARGUMENTS - 全部参数
    if (content.includes('$ARGUMENTS')) {
      content = content.replace(/\$ARGUMENTS/g, args);
    }

    // $ARGUMENTS[N] - 按索引访问参数
    content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, index) => {
      const i = parseInt(index, 10);
      return argsArray[i] || '';
    });

    // $0, $1, $2... - 位置参数简写
    content = content.replace(/\$(\d+)/g, (_, index) => {
      const i = parseInt(index, 10);
      return argsArray[i] || '';
    });

    // ${CLAUDE_SESSION_ID}
    if (this.context.sessionId) {
      content = content.replace(/\$\{CLAUDE_SESSION_ID\}/g, this.context.sessionId);
    }

    // ${CLAUDE_SKILL_DIR}
    content = content.replace(/\$\{CLAUDE_SKILL_DIR\}/g, this.context.skillDir);

    return content;
  }

  /**
   * 解析参数字符串为数组
   * 支持引号包裹的参数
   */
  private parseArguments(args: string): string[] {
    if (!args.trim()) return [];

    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < args.length; i++) {
      const char = args[i];

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ') {
        if (current) {
          result.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      result.push(current);
    }

    return result;
  }
}

/**
 * 创建模板处理器
 */
export function createSkillTemplateProcessor(context: SkillTemplateContext): SkillTemplateProcessor {
  return new SkillTemplateProcessor(context);
}