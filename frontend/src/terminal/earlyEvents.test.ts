import { describe, expect, it } from 'vitest';
import { EarlyEvents } from './earlyEvents';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join('');

describe('EarlyEvents', () => {
  it('keeps data and the exit that arrive before a session registers', () => {
    const early = new EarlyEvents();
    early.data('t1', bytes("'claude' is not recognized"));
    early.exit('t1', { id: 't1', error: 'exit status 1' });

    const got = early.take('t1');
    expect(text(got.chunks)).toBe("'claude' is not recognized");
    expect(got.exit?.error).toBe('exit status 1');
    // take() hands everything over exactly once.
    expect(early.take('t1')).toEqual({ chunks: [], exit: undefined });
  });

  it('keeps sessions separate', () => {
    const early = new EarlyEvents();
    early.data('a', bytes('A'));
    early.data('b', bytes('B'));
    expect(text(early.take('a').chunks)).toBe('A');
    expect(text(early.take('b').chunks)).toBe('B');
  });

  it('caps buffered bytes per session, keeping the newest output', () => {
    const early = new EarlyEvents({ maxBytes: 4, maxSessions: 10 });
    early.data('t', bytes('12'));
    early.data('t', bytes('34'));
    early.data('t', bytes('56'));
    expect(text(early.take('t').chunks)).toBe('3456');
  });

  it('forgets the oldest session when too many never register', () => {
    const early = new EarlyEvents({ maxBytes: 100, maxSessions: 2 });
    early.data('a', bytes('A'));
    early.data('b', bytes('B'));
    early.data('c', bytes('C'));
    expect(early.take('a').chunks).toEqual([]);
    expect(text(early.take('c').chunks)).toBe('C');
  });
});
