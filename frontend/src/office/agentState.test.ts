import { describe, expect, it } from 'vitest';
import { WALL_H, bubbleFor, deskSpot, nextState, progressOf, type AgentState } from './agentState';

const idle: AgentState = { mood: 'idle', tool: '', since: 0 };

describe('nextState', () => {
  it('goes idle when the user interrupts a request', () => {
    const working = nextState(nextState(idle, { event: 'UserPromptSubmit' }, 1), { event: 'PreToolUse', tool: 'Bash' }, 2);
    expect(nextState(working, { event: 'Interrupt' }, 3).mood).toBe('idle');
  });

  it('follows a Claude turn: prompt → thinking → working → thinking → done', () => {
    let s = nextState(idle, { event: 'UserPromptSubmit' }, 1);
    expect(s.mood).toBe('thinking');
    s = nextState(s, { event: 'PreToolUse', tool: 'Edit' }, 2);
    expect(s).toMatchObject({ mood: 'working', tool: 'Edit', since: 2, tools: 1 });
    s = nextState(s, { event: 'PostToolUse', tool: 'Edit' }, 3);
    expect(s.mood).toBe('thinking');
    s = nextState(s, { event: 'Stop' }, 4);
    expect(s.mood).toBe('idle');
  });

  it('shows waiting when Claude needs the user', () => {
    const s = nextState({ mood: 'working', tool: 'Bash', since: 1 }, { event: 'Notification', message: 'Claude needs your permission to use Bash' }, 2);
    expect(s.mood).toBe('waiting');
    // The next prompt or tool clears it.
    expect(nextState(s, { event: 'PreToolUse', tool: 'Bash' }, 3).mood).toBe('working');
  });

  it('ignores unknown events and keeps state immutable', () => {
    const s = nextState(idle, { event: 'SomethingNew' }, 5);
    expect(s).toBe(idle);
  });
});

describe('bubbleFor', () => {
  it('shows short tool names, ? and …', () => {
    expect(bubbleFor({ mood: 'working', tool: 'mcp__work-dashboard__open_files', since: 0 })).toBe('open_files');
    expect(bubbleFor({ mood: 'working', tool: 'Bash', since: 0 })).toBe('Bash');
    expect(bubbleFor({ mood: 'waiting', tool: '', since: 0 })).toBe('?');
    expect(bubbleFor({ mood: 'thinking', tool: '', since: 0 })).toBe('…');
    expect(bubbleFor(idle)).toBe('');
  });
});

describe('deskSpot', () => {
  it('lays desks out in rows within the floor', () => {
    const w = 600;
    const spots = Array.from({ length: 8 }, (_, i) => deskSpot(i, w));
    for (const s of spots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(w);
    }
    // Wraps to a second row when the row is full.
    expect(spots.some((s) => s.y > spots[0].y)).toBe(true);
    // Distinct spots, all below the bookshelf wall.
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(8);
    expect(Math.min(...spots.map((s) => s.y))).toBeGreaterThanOrEqual(WALL_H);
  });
});

describe('progress', () => {
  it('counts tool calls and time since the prompt when there is no to-do list', () => {
    let s = nextState(idle, { event: 'UserPromptSubmit' }, 1000);
    s = nextState(s, { event: 'PreToolUse', tool: 'Read' }, 2000);
    s = nextState(s, { event: 'PostToolUse', tool: 'Read' }, 3000);
    s = nextState(s, { event: 'PreToolUse', tool: 'Edit' }, 4000);
    expect(progressOf(s, 1000 + 133_000)).toEqual({ fraction: null, text: '도구 2 · 2:13' });
  });

  it('uses the to-do list when Claude keeps one', () => {
    let s = nextState(idle, { event: 'UserPromptSubmit' }, 0);
    s = nextState(s, { event: 'PostToolUse', tool: 'TodoWrite', progress: { done: 2, total: 5, current: '테스트 실행 중' } }, 10);
    expect(progressOf(s, 20)).toEqual({ fraction: 0.4, text: '2/5 테스트 실행 중' });
  });

  it('shows nothing when idle and resets on the next prompt', () => {
    let s = nextState(idle, { event: 'UserPromptSubmit' }, 0);
    s = nextState(s, { event: 'PostToolUse', tool: 'TodoWrite', progress: { done: 1, total: 2 } }, 1);
    s = nextState(s, { event: 'Stop' }, 2);
    expect(progressOf(s, 3)).toBeNull();
    s = nextState(s, { event: 'UserPromptSubmit' }, 4);
    expect(progressOf(s, 4)?.fraction).toBeNull();
  });
});
