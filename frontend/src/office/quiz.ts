/**
 * Quiz breaks: while usage is low, a Claude session that has been idle for a
 * while sometimes offers a quiz — about what it built, or an algorithm one.
 * Saying yes types a prompt into its terminal, so Claude asks and grades it.
 */
import type { Mood } from './agentState';

export type QuizKind = 'session' | 'algorithm';

/** A session must be idle this long before it offers a quiz. */
export const QUIZ_IDLE_MS = 2 * 60_000;
/** Offers only below this share of the 5-hour limit (the quiz costs tokens). */
export const QUIZ_LOW_USAGE = 50;
/** How often the office looks for a session to offer, and the odds it does. */
export const QUIZ_CHECK_MS = 60_000;
export const QUIZ_CHANCE = 0.35;
/** Quiet time after an offer, whatever the answer. */
export const QUIZ_GAP_MS = 20 * 60_000;
/** An unanswered offer goes away after this. */
export const QUIZ_OFFER_MS = 60_000;
/** Share of session quizzes for a session that has done work. */
const SESSION_SHARE = 0.6;

export interface QuizCandidate {
  id: string;
  kind: 'claude' | 'shell';
  alive: boolean;
  mood: Mood;
  since: number; // when the mood last changed
  tokens: number;
  finished: boolean; // Claude finished a reply (a fresh tab may sit at a login or trust prompt)
  typed: boolean; // the user typed since: a draft in the input box would be sent with the quiz
}

export const lowUsage = (fiveHour: number | null) => fiveHour !== null && fiveHour < QUIZ_LOW_USAGE;

/** A session quiz needs work to ask about; otherwise an algorithm one. */
export const quizKind = (tokens: number, rand: number): QuizKind => (tokens > 0 && rand < SESSION_SHARE ? 'session' : 'algorithm');

export function canOffer(c: QuizCandidate, now: number): boolean {
  return c.kind === 'claude' && c.alive && c.mood === 'idle' && c.finished && !c.typed && now - c.since >= QUIZ_IDLE_MS;
}

/** One idle Claude session, chosen at random, or null when none qualifies. */
export function pickQuizOffer<T extends QuizCandidate>(cands: T[], now: number, rand: () => number): T | null {
  const ok = cands.filter((c) => canOffer(c, now));
  if (!ok.length) return null;
  return ok[Math.min(ok.length - 1, Math.floor(rand() * ok.length))];
}

/** The question in the speech bubble. */
export const quizQuestion = (kind: QuizKind) =>
  kind === 'session' ? '이 세션에서 구현한 내용으로 퀴즈 풀래요?' : '알고리즘 퀴즈 하나 풀래요?';

const RULES = '4지선다로 내고 코드는 수정하지 말고, 내가 답하면 정답과 짧은 해설을 알려줘.';

/** The prompt typed into the session's terminal (one line: Enter submits it). */
export function quizPrompt(kind: QuizKind): string {
  return kind === 'session'
    ? `[대시보드 퀴즈] 이 세션에서 지금까지 구현하거나 고친 내용을 내가 이해했는지 확인하는 퀴즈 1문제를 ${RULES}`
    : `[대시보드 퀴즈] 알고리즘·자료구조 퀴즈 1문제(시간복잡도, 자료구조 고르기, 짧은 코드의 결과 예측 중 하나)를 ${RULES}`;
}
