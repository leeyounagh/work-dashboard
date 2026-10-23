/** What a character in the office is doing, driven by Claude hook events. */

export type Mood = 'idle' | 'thinking' | 'working' | 'waiting';

export interface TodoProgress {
  done: number;
  total: number;
  current?: string;
}

export interface AgentState {
  mood: Mood;
  tool: string; // current tool while working
  since: number; // ms timestamp of the last change
  // The current request: when it started, tools used, and Claude's to-do list.
  started?: number;
  tools?: number;
  todos?: TodoProgress;
}

export interface HookInput {
  event: string;
  tool?: string;
  message?: string;
  progress?: TodoProgress | null;
}

export function nextState(s: AgentState, ev: HookInput, now: number): AgentState {
  const todos = ev.progress ?? s.todos;
  switch (ev.event) {
    case 'UserPromptSubmit':
      // A new request starts its own progress.
      return { mood: 'thinking', tool: '', since: now, started: now, tools: 0 };
    case 'PostToolUse':
      return { ...s, mood: 'thinking', tool: '', since: now, todos };
    case 'PreToolUse':
      return { ...s, mood: 'working', tool: ev.tool ?? '', since: now, tools: (s.tools ?? 0) + 1, todos };
    case 'Notification':
      // Permission prompts and "waiting for input" both need the user.
      return { ...s, mood: 'waiting', since: now };
    case 'Stop':
    case 'SessionStart':
    case 'SessionEnd':
      return { mood: 'idle', tool: '', since: now };
    default:
      return s;
  }
}

/**
 * How far the current request is: Claude's to-do list when it keeps one
 * (fraction + "2/5 current step"), otherwise tool calls and elapsed time.
 */
export function progressOf(s: AgentState, now: number): { fraction: number | null; text: string } | null {
  if (s.mood === 'idle' || s.started === undefined) return null;
  if (s.todos && s.todos.total > 0) {
    const current = s.todos.current ? ` ${s.todos.current}` : '';
    return { fraction: s.todos.done / s.todos.total, text: `${s.todos.done}/${s.todos.total}${current}` };
  }
  const secs = Math.max(0, Math.floor((now - s.started) / 1000));
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return { fraction: null, text: `도구 ${s.tools ?? 0} · ${time}` };
}

/** Text in the speech bubble above a character. */
export function bubbleFor(s: AgentState): string {
  switch (s.mood) {
    case 'working':
      return s.tool.split('__').pop() ?? s.tool; // mcp__server__tool → tool
    case 'waiting':
      return '?';
    case 'thinking':
      return '…';
    default:
      return '';
  }
}

export const DESK_W = 112; // a 96px desk plus room to walk
export const DESK_H = 84;
/** Height of the bookshelf wall at the top of the office. */
export const WALL_H = 72;
const MARGIN = 16;

/** Where the i-th desk sits (top-left of the desk area) on a floor of the given width (CSS px). */
export function deskSpot(i: number, floorWidth: number): { x: number; y: number } {
  const perRow = Math.max(1, Math.floor((floorWidth - MARGIN * 2) / DESK_W));
  const col = i % perRow;
  const row = Math.floor(i / perRow);
  return { x: MARGIN + col * DESK_W + DESK_W / 2, y: WALL_H + 8 + row * DESK_H };
}

/** Default titles are "Claude · <workspace>"; the workspace is already shown below. */
export const nameLabel = (title: string) => title.replace(/^(Claude|Shell) · .*$/, '$1');
