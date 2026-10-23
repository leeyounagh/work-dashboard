/** What a character in the office is doing, driven by Claude hook events. */

export type Mood = 'idle' | 'thinking' | 'working' | 'waiting';

export interface AgentState {
  mood: Mood;
  tool: string; // current tool while working
  since: number; // ms timestamp of the last change
}

export interface HookInput {
  event: string;
  tool?: string;
  message?: string;
}

export function nextState(s: AgentState, ev: HookInput, now: number): AgentState {
  switch (ev.event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return { mood: 'thinking', tool: '', since: now };
    case 'PreToolUse':
      return { mood: 'working', tool: ev.tool ?? '', since: now };
    case 'Notification':
      // Permission prompts and "waiting for input" both need the user.
      return { mood: 'waiting', tool: s.tool, since: now };
    case 'Stop':
    case 'SessionStart':
    case 'SessionEnd':
      return { mood: 'idle', tool: '', since: now };
    default:
      return s;
  }
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
