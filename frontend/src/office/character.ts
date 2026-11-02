/** A character in the office: one per terminal, plus the guide. */
import type { AgentState } from './agentState';
import { NO_STREAK, type Streak } from './fun';
import type { Direction } from './sprites';

/** A terminal as the office sees it. */
export interface OfficeTerminal {
  id: string;
  title: string; // terminal (tab) name, shown above the character
  workspace: string; // workspace name, shown below
  workspaceId: string;
  kind: 'claude' | 'shell';
  alive: boolean;
}

export interface Character {
  term: OfficeTerminal;
  state: AgentState;
  sheet: HTMLImageElement;
  dog: boolean;
  dir: Direction;
  desk: number;
  shown: boolean; // in the selected workspace
  x: number;
  y: number;
  tx: number;
  ty: number;
  nextWander: number;
  phase: number;
  // An idle pose from rows 5–6 of your own sheets, held until poseUntil.
  pose: number | null;
  poseUntil: number;
  nextPoseAt: number;
  tokens: number; // this session's tokens since the dashboard opened it
  celebrate: { at: number; label: string } | null; // a token milestone
  wantsCoffee: boolean; // queueing at the empty pot
  finished: boolean; // Claude finished a reply since the last prompt
  streak: Streak; // working without a long break: a flame by the name
  highFive: { partner: string; met: number | null; until: number } | null;
}

/** A fresh, idle character standing at (x, y). */
export function newCharacter(
  term: OfficeTerminal,
  sheet: HTMLImageElement,
  dog: HTMLImageElement,
  at: { x: number; y: number; desk: number; shown: boolean; since: number; phase: number; nextPoseAt: number },
): Character {
  return {
    term,
    state: { mood: 'idle', tool: '', since: at.since },
    sheet,
    dog: sheet === dog,
    dir: 'down',
    desk: at.desk,
    shown: at.shown,
    x: at.x,
    y: at.y,
    tx: at.x,
    ty: at.y,
    nextWander: 0,
    phase: at.phase,
    pose: null,
    poseUntil: 0,
    nextPoseAt: at.nextPoseAt,
    tokens: 0,
    celebrate: null,
    wantsCoffee: false,
    finished: false,
    streak: NO_STREAK,
    highFive: null,
  };
}
