import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Agent } from '../../core/agent.js';
import type { CLIConfig } from '../types.js';
import type { ChatLine, TuiModal } from './types.js';
import { messagesToTerminalLines } from '../utils/chat-history.js';
import { handleSlashCommand, type SlashContext } from '../utils/slash-commands.js';
import type { SessionCheckpoint } from '../../core/types.js';
import { ensureChatSessionAttached } from '../utils/agent-bootstrap.js';
import { listSessionsForPicker, type SessionPickerItem } from '../utils/session-cli.js';
import { useSessionStatus } from './hooks/use-session-status.js';
import {
  buildSlashMenuItems,
  filterSlashMenuItems,
  slashMenuDropdownOpen
} from './slash-menu.js';
import { parseTuiModalCommand, tuiModalFromCommand } from './tui-command-route.js';
import { TuiHeader } from './components/TuiHeader.js';
import { ChatLog } from './components/ChatLog.js';
import { InputArea } from './components/InputArea.js';
import { SlashMenu } from './components/SlashMenu.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpPanel } from './components/modals/HelpPanel.js';
import { CheckpointPanel } from './components/modals/CheckpointPanel.js';
import { StatusPanel } from './components/modals/StatusPanel.js';
import { SessionPicker } from './components/modals/SessionPicker.js';
import { stripAnsi, withCapturedConsoleLog } from './capture-console.js';
import { createEmptyStreamBuffers, reduceStreamEvent } from './stream-buffers.js';
import {
  toolLineFromCall,
  toolLineFromError,
  toolLineFromResult
} from './format-tool-events.js';

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
  const [thinkingBuf, setThinkingBuf] = useState('');
  const [status, setStatus] = useState('');
  const [verbose, setVerbose] = useState(options.verbose === true);
  const [modal, setModal] = useState<TuiModal>('none');
  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([]);
  const [sessions, setSessions] = useState<SessionPickerItem[]>([]);
  const [checkpointsIdx, setCheckpointsIdx] = useState(0);
  const [sessionsIdx, setSessionsIdx] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const { snapshot, refresh: refreshStatus } = useSessionStatus({
    agent,
    sessionId,
    verbose,
    streaming,
    cwd
  });

  const allMenuItems = useMemo(
    () => buildSlashMenuItems(agent.getSkillRegistry().getUserInvocableSkills()),
    [agent]
  );

  const filteredMenuItems = useMemo(
    () => filterSlashMenuItems(allMenuItems, input),
    [allMenuItems, input]
  );

  const menuOpen =
    !menuDismissed &&
    !streaming &&
    modal === 'none' &&
    slashMenuDropdownOpen(input, filteredMenuItems);

  useEffect(() => {
    setMenuIndex(0);
    setMenuDismissed(false);
  }, [input]);

  const reloadLines = useCallback(async () => {
    const messages = await agent.getSessionManager().loadActiveMessages();
    setLines(
      messagesToTerminalLines(messages, { verbose, toolTrace: true }).map((l) => ({
        role: l.role as ChatLine['role'],
        text: l.text,
        toolKind: l.toolKind
      }))
    );
  }, [agent, verbose]);

  const syncFromSession = useCallback(async () => {
    await reloadLines();
    await refreshStatus();
  }, [reloadLines, refreshStatus]);

  useEffect(() => {
    void syncFromSession();
  }, [syncFromSession]);

  const openModal = useCallback(
    async (kind: TuiModal) => {
      if (kind === 'checkpoints') {
        const cps = await agent.listSessionCheckpoints();
        setCheckpoints(cps);
        setCheckpointsIdx(0);
      } else if (kind === 'sessions') {
        const items = await listSessionsForPicker(options.userBasePath, 20);
        setSessions(items);
        setSessionsIdx(0);
      } else if (kind === 'status') {
        await refreshStatus();
      }
      setModal(kind);
    },
    [agent, options.userBasePath, refreshStatus]
  );

  const runStream = useCallback(
    async (text: string) => {
      setStreaming(true);
      setStreamBuf('');
      setThinkingBuf('');
      setStatus('Streaming… (Esc to cancel)');
      const ac = new AbortController();
      abortRef.current = ac;
      const userLine: ChatLine = { role: 'user', text };
      setLines((prev) => [...prev, userLine]);
      let buffers = createEmptyStreamBuffers();
      const erroredToolCallIds = new Set<string>();
      try {
        const processed = await agent.processInput(text);
        const prompt = processed.invoked ? processed.prompt : text;
        for await (const event of agent.stream(prompt, { sessionId, signal: ac.signal })) {
          if (event.type === 'tool_call') {
            setLines((prev) => [
              ...prev,
              toolLineFromCall(verbose, event.name, event.arguments)
            ]);
            continue;
          }
          if (event.type === 'tool_error') {
            erroredToolCallIds.add(event.toolCallId);
            setLines((prev) => [
              ...prev,
              toolLineFromError(verbose, event.error)
            ]);
            continue;
          }
          if (event.type === 'tool_result') {
            if (erroredToolCallIds.has(event.toolCallId)) continue;
            setLines((prev) => [
              ...prev,
              toolLineFromResult(verbose, event.result)
            ]);
            continue;
          }
          buffers = reduceStreamEvent(buffers, event);
          setThinkingBuf(buffers.thinking);
          setStreamBuf(buffers.assistant);
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        setStreaming(false);
        setStreamBuf('');
        setThinkingBuf('');
        setStatus((prev) => (prev === 'Streaming… (Esc to cancel)' ? '' : prev));
        abortRef.current = null;
        const sid = agent.getSessionManager().sessionId;
        if (sid) setSessionId(sid);
        await syncFromSession();
      }
    },
    [agent, sessionId, verbose, syncFromSession]
  );

  const applySlashResult = useCallback(
    async (slash: Awaited<ReturnType<typeof handleSlashCommand>>): Promise<boolean> => {
      if (!slash.handled) return false;
      if (slash.exit) {
        await onExit();
        exit();
        return true;
      }
      if (slash.sessionId !== undefined) setSessionId(slash.sessionId);
      if (slash.verbose !== undefined) setVerbose(slash.verbose);
      if (slash.replayHistory) await syncFromSession();
      if (slash.pendingUserInput) {
        await runStream(slash.pendingUserInput);
      }
      return true;
    },
    [onExit, exit, syncFromSession, runStream]
  );

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || busyRef.current) return;
    setInput('');
    setMenuDismissed(false);
    busyRef.current = true;

    try {
      const modalCmd = parseTuiModalCommand(text);
      if (modalCmd) {
        await openModal(tuiModalFromCommand(modalCmd));
        return;
      }

      if (text.startsWith('/')) {
        const slashCtx: SlashContext = {
          sessionId,
          verbose,
          userBasePath: options.userBasePath,
          cwd,
          askLine: async () => '',
          onReplay: async (opts) => {
            if (opts?.verbose !== undefined) setVerbose(opts.verbose);
            await syncFromSession();
          }
        };
        const { result: slash, logs } = await withCapturedConsoleLog(() =>
          handleSlashCommand(agent, text, slashCtx)
        );
        if (logs.length > 0) {
          setStatus(stripAnsi(logs.join(' ')).slice(0, 240));
        }
        if (await applySlashResult(slash)) return;

        const skill = await agent.processInput(text);
        if (skill.invoked) {
          await runStream(text);
          return;
        }
        setStatus('Unknown command. Type /help');
        return;
      }

      await runStream(text);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busyRef.current = false;
    }
  }, [
    input,
    streaming,
    sessionId,
    verbose,
    options.userBasePath,
    cwd,
    agent,
    syncFromSession,
    runStream,
    openModal,
    applySlashResult
  ]);

  const applyMenuCompletion = useCallback(() => {
    const item = filteredMenuItems[menuIndex];
    if (!item) return;
    setInput(item.insertText);
    setMenuDismissed(true);
  }, [filteredMenuItems, menuIndex]);

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
      // help/status are non-blocking overlays; only pickers capture navigation keys.
      if (modal === 'checkpoints' || modal === 'sessions') {
        if (modal === 'checkpoints') {
          if (key.upArrow) setCheckpointsIdx((i) => Math.max(0, i - 1));
          if (key.downArrow) setCheckpointsIdx((i) => Math.min(checkpoints.length - 1, i + 1));
          if (key.return) {
            const cp = checkpoints[checkpointsIdx];
            if (cp) {
              void (async () => {
                await agent.rewindToCheckpoint({ userTurnIndex: cp.userTurnIndex });
                await syncFromSession();
                setModal('none');
              })();
            }
          }
        }
        if (modal === 'sessions') {
          if (key.upArrow) setSessionsIdx((i) => Math.max(0, i - 1));
          if (key.downArrow) setSessionsIdx((i) => Math.min(sessions.length - 1, i + 1));
          if (key.return) {
            const picked = sessions[sessionsIdx];
            if (picked) {
              void (async () => {
                await ensureChatSessionAttached(agent, picked.id);
                setSessionId(picked.id);
                await syncFromSession();
                setModal('none');
              })();
            }
          }
        }
        return;
      }
    }

    if (menuOpen) {
      if (key.escape) {
        setMenuDismissed(true);
        return;
      }
      if (key.upArrow) {
        setMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setMenuIndex((i) => Math.min(filteredMenuItems.length - 1, i + 1));
        return;
      }
      if (key.tab || (key.return && filteredMenuItems.length > 0)) {
        applyMenuCompletion();
        return;
      }
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

  return (
    <Box flexDirection="column" height="100%">
      <TuiHeader modelName={modelName} cwd={cwd} />
      <StatusBar snapshot={snapshot} streaming={streaming} />
      {status ? (
        <Box paddingX={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      ) : null}
      <ChatLog
        lines={lines}
        streaming={streaming}
        streamBuf={streamBuf}
        thinkingBuf={thinkingBuf}
      />
      {modal === 'help' ? <HelpPanel /> : null}
      {modal === 'status' ? <StatusPanel snapshot={snapshot} /> : null}
      {modal === 'checkpoints' ? (
        <CheckpointPanel checkpoints={checkpoints} selectedIndex={checkpointsIdx} />
      ) : null}
      {modal === 'sessions' ? (
        <SessionPicker sessions={sessions} selectedIndex={sessionsIdx} />
      ) : null}
      {menuOpen ? <SlashMenu items={filteredMenuItems} selectedIndex={menuIndex} /> : null}
      <InputArea input={input} streaming={streaming} />
    </Box>
  );
}

/** Load checkpoints into modal (exported for tests). */
export async function openCheckpointsModal(agent: Agent, sessionId?: string): Promise<SessionCheckpoint[]> {
  if (sessionId) await ensureChatSessionAttached(agent, sessionId);
  return agent.listSessionCheckpoints();
}
