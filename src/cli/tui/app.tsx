import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Agent } from '../../core/agent.js';
import type { CLIConfig } from '../types.js';
import type { ChatLine, TuiModal } from './types.js';
import { messagesToTerminalLines } from '../utils/chat-history.js';
import { handleSlashCommand, type SlashContext } from '../utils/slash-commands.js';
import { SLASH_COMMANDS } from '../utils/slash-registry.js';
import type { SessionCheckpoint } from '../../core/types.js';
import { ensureChatSessionAttached } from '../utils/agent-bootstrap.js';

interface TuiAppProps {
  agent: Agent;
  options: CLIConfig;
  cwd: string;
  initialSessionId?: string;
  onExit: () => Promise<void>;
}

export function TuiApp({ agent, options, cwd, initialSessionId, onExit }: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuf, setStreamBuf] = useState('');
  const [status, setStatus] = useState('');
  const [verbose, setVerbose] = useState(options.verbose === true);
  const [modal, setModal] = useState<TuiModal>('none');
  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([]);
  const [sessionPickerIdx, setSessionPickerIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const reloadLines = useCallback(async () => {
    const messages = await agent.getSessionManager().loadActiveMessages();
    setLines(
      messagesToTerminalLines(messages, { verbose }).map((l) => ({
        role: l.role as ChatLine['role'],
        text: l.text
      }))
    );
  }, [agent, verbose]);

  useEffect(() => {
    void reloadLines();
  }, [reloadLines]);

  const runStream = useCallback(
    async (text: string) => {
      setStreaming(true);
      setStreamBuf('');
      setStatus('Streaming… (Esc to cancel)');
      const ac = new AbortController();
      abortRef.current = ac;
      const userLine: ChatLine = { role: 'user', text };
      setLines((prev) => [...prev, userLine]);
      let assistant = '';
      try {
        const processed = await agent.processInput(text);
        const prompt = processed.invoked ? processed.prompt : text;
        for await (const event of agent.stream(prompt, { sessionId, signal: ac.signal })) {
          if (event.type === 'text_delta') {
            assistant += event.content;
            setStreamBuf(assistant);
          }
        }
        if (assistant.trim()) {
          setLines((prev) => [...prev, { role: 'assistant', text: assistant }]);
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        setStreaming(false);
        setStreamBuf('');
        setStatus('');
        abortRef.current = null;
        const sid = agent.getSessionManager().sessionId;
        if (sid) setSessionId(sid);
      }
    },
    [agent, sessionId]
  );

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    if (text.startsWith('/')) {
      const slashCtx: SlashContext = {
        sessionId,
        verbose,
        userBasePath: options.userBasePath,
        cwd,
        askLine: async () => '',
        onReplay: async (opts) => {
          if (opts?.verbose !== undefined) setVerbose(opts.verbose);
          await reloadLines();
        }
      };
      const slash = await handleSlashCommand(agent, text, slashCtx);
      if (slash.handled) {
        if (slash.exit) {
          await onExit();
          exit();
          return;
        }
        if (slash.sessionId !== undefined) setSessionId(slash.sessionId);
        if (slash.verbose !== undefined) setVerbose(slash.verbose);
        if (slash.replayHistory) await reloadLines();
        if (slash.pendingUserInput) {
          await runStream(slash.pendingUserInput);
        }
        if (text === '/help' || text.startsWith('/help ')) setModal('help');
        if (text === '/checkpoints' || text.startsWith('/checkpoints')) {
          const cps = await agent.listSessionCheckpoints();
          setCheckpoints(cps);
          setModal('checkpoints');
        }
        return;
      }
      const skill = await agent.processInput(text);
      if (skill.invoked) {
        await runStream(text);
        return;
      }
      setStatus('Unknown command. Type /help');
      return;
    }

    await runStream(text);
  }, [
    input,
    streaming,
    sessionId,
    verbose,
    options.userBasePath,
    cwd,
    agent,
    reloadLines,
    runStream,
    onExit,
    exit
  ]);

  useInput((inputKey, key) => {
    if (key.escape && streaming && abortRef.current) {
      abortRef.current.abort();
      setStatus('Interrupted');
      return;
    }
    if (modal !== 'none') {
      if (key.escape) {
        setModal('none');
        return;
      }
      if (modal === 'checkpoints' && key.upArrow) {
        setSessionPickerIdx((i) => Math.max(0, i - 1));
      }
      if (modal === 'checkpoints' && key.downArrow) {
        setSessionPickerIdx((i) => Math.min(checkpoints.length - 1, i + 1));
      }
      if (modal === 'checkpoints' && key.return) {
        const cp = checkpoints[sessionPickerIdx];
        if (cp) {
          void (async () => {
            await agent.rewindToCheckpoint({ userTurnIndex: cp.userTurnIndex });
            await reloadLines();
            setModal('none');
          })();
        }
      }
      return;
    }
    if (key.return) {
      void submit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (inputKey && !key.ctrl && !key.meta) {
      setInput((v) => v + inputKey);
    }
  });

  const modelName = agent.getModel().name;
  const sidShort = sessionId ? sessionId.slice(0, 8) + '…' : 'new';

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" paddingX={1}>
        <Text>
          Agent SDK TUI | {modelName} | session {sidShort} | /help Esc=close modal
        </Text>
      </Box>
      {status ? (
        <Box paddingX={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {lines.map((line, i) => (
          <Text key={`${i}-${line.role}`} wrap="wrap">
            <Text color={line.role === 'user' ? 'green' : line.role === 'assistant' ? 'blue' : 'gray'}>
              {line.role}:{' '}
            </Text>
            {line.text}
          </Text>
        ))}
        {streaming && streamBuf ? (
          <Text wrap="wrap">
            <Text color="blue">assistant: </Text>
            {streamBuf}
          </Text>
        ) : null}
      </Box>
      {modal === 'help' ? (
        <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
          <Text bold>Slash commands</Text>
          {SLASH_COMMANDS.map((c) => (
            <Text key={c.name}>
              /{c.name} — {c.description}
            </Text>
          ))}
        </Box>
      ) : null}
      {modal === 'checkpoints' ? (
        <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
          <Text bold>Checkpoints (↑↓ Enter rewind, Esc close)</Text>
          {checkpoints.length === 0 ? (
            <Text dimColor>None</Text>
          ) : (
            checkpoints.map((c, i) => (
              <Text key={c.checkpointId} color={i === sessionPickerIdx ? 'cyan' : undefined}>
                #{c.userTurnIndex} {c.preview.slice(0, 50)}
              </Text>
            ))
          )}
        </Box>
      ) : null}
      <Box borderStyle="single" paddingX={1}>
        <Text color="green">{streaming ? '…' : '› '}</Text>
        <Text>{input}</Text>
        <Text dimColor>{streaming ? '' : '█'}</Text>
      </Box>
    </Box>
  );
}

/** Load checkpoints into modal (exported for tests). */
export async function openCheckpointsModal(agent: Agent, sessionId?: string): Promise<SessionCheckpoint[]> {
  if (sessionId) await ensureChatSessionAttached(agent, sessionId);
  return agent.listSessionCheckpoints();
}
