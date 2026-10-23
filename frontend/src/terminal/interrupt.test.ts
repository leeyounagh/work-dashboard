import { describe, expect, it } from 'vitest';
import { InterruptWatch } from './interrupt';

const enc = (s: string) => new TextEncoder().encode(s);

describe('InterruptWatch', () => {
  it('spots the interrupt notice Claude Code prints after Esc', () => {
    const w = new InterruptWatch();
    expect(w.feed('a', enc('working…'))).toBe(false);
    expect(w.feed('a', enc('\x1b[31m  ⎿  Interrupted · What should Claude do instead?\x1b[0m'))).toBe(true);
  });

  it('finds the word when colours or chunks split it', () => {
    const w = new InterruptWatch();
    expect(w.feed('a', enc('⎿  Inter'))).toBe(false);
    expect(w.feed('a', enc('\x1b[1mrupted · What should Claude do instead?'))).toBe(true);
  });

  it('reports one notice once and keeps terminals apart', () => {
    const w = new InterruptWatch();
    expect(w.feed('a', enc('Inter'))).toBe(false);
    expect(w.feed('b', enc('rupted'))).toBe(false);
    expect(w.feed('a', enc('rupted by user'))).toBe(true);
    expect(w.feed('a', enc(' · next output'))).toBe(false);
  });

  it('decodes multi-byte characters split across chunks', () => {
    const w = new InterruptWatch();
    const bytes = enc('⎿ Interrupted · What should Claude do instead?');
    expect(w.feed('a', bytes.slice(0, 2))).toBe(false);
    expect(w.feed('a', bytes.slice(2))).toBe(true);
  });

  it('ignores the word in ordinary output', () => {
    const w = new InterruptWatch();
    expect(w.feed('a', enc('- handle Interrupted state\n+ if (interrupted) retry()'))).toBe(false);
  });

  it('matches when cursor moves replace the spaces', () => {
    const w = new InterruptWatch();
    expect(w.feed('a', enc('⎿\x1b[2CInterrupted\x1b[1C·\x1b[1CWhat should Claude do instead?'))).toBe(true);
  });
});
