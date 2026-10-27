import { describe, expect, it } from 'vitest';
import { QUIZ_IDLE_MS, lowUsage, pickQuizOffer, quizKind, quizPrompt, quizQuestion, type QuizCandidate } from './quiz';

const idle = (id: string, since = 0, extra: Partial<QuizCandidate> = {}): QuizCandidate => ({
  id,
  kind: 'claude',
  alive: true,
  mood: 'idle',
  since,
  tokens: 0,
  finished: true,
  typed: false,
  ...extra,
});

describe('lowUsage', () => {
  it('is true only for a known 5-hour usage under half', () => {
    expect(lowUsage(10)).toBe(true);
    expect(lowUsage(49)).toBe(true);
    expect(lowUsage(50)).toBe(false);
    expect(lowUsage(null)).toBe(false);
  });
});

describe('quizKind', () => {
  it('asks about the session only when it has done work', () => {
    expect(quizKind(0, 0)).toBe('algorithm');
    expect(quizKind(5_000, 0.1)).toBe('session');
    expect(quizKind(5_000, 0.9)).toBe('algorithm');
  });
});

describe('pickQuizOffer', () => {
  const now = QUIZ_IDLE_MS + 1;

  it('picks a Claude session idle for long enough', () => {
    expect(pickQuizOffer([idle('a')], now, () => 0)?.id).toBe('a');
  });

  it('skips busy, short-idle, shell and closed sessions', () => {
    const cands = [
      idle('busy', 0, { mood: 'working' }),
      idle('fresh', now - 1000),
      idle('shell', 0, { kind: 'shell' }),
      idle('dead', 0, { alive: false }),
      idle('fresh tab', 0, { finished: false }),
      idle('draft', 0, { typed: true }),
    ];
    expect(pickQuizOffer(cands, now, () => 0)).toBeNull();
  });

  it('chooses among eligible sessions with the random source', () => {
    const cands = [idle('a'), idle('b'), idle('c')];
    expect(pickQuizOffer(cands, now, () => 0.99)?.id).toBe('c');
  });
});

describe('quiz text', () => {
  it('asks a question matching the kind', () => {
    expect(quizQuestion('session')).toContain('이 세션');
    expect(quizQuestion('algorithm')).toContain('알고리즘');
  });

  it('builds a one-line prompt that leaves the code alone', () => {
    for (const kind of ['session', 'algorithm'] as const) {
      const p = quizPrompt(kind);
      expect(p).not.toContain('\n');
      expect(p).toContain('수정하지 말고');
    }
  });
});
