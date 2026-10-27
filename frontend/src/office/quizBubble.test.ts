// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { QuizBubble } from './quizBubble';

const setup = () => {
  const host = document.createElement('div');
  return { host, bubble: new QuizBubble(host) };
};
const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];

describe('QuizBubble', () => {
  it('starts hidden and shows the question at a position', () => {
    const { host, bubble } = setup();
    const el = host.querySelector<HTMLElement>('.quiz-bubble')!;
    expect(el.hidden).toBe(true);
    bubble.show('퀴즈 풀래요?', 100.4, 50.6, () => {});
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain('퀴즈 풀래요?');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('51px');
  });

  it('stays inside the office near its edges', () => {
    const { host, bubble } = setup();
    const el = host.querySelector<HTMLElement>('.quiz-bubble')!;
    Object.defineProperty(host, 'clientWidth', { value: 300 });
    Object.defineProperty(el, 'offsetWidth', { value: 100 });
    Object.defineProperty(el, 'offsetHeight', { value: 40 });
    bubble.show('q', 10, 5, () => {});
    expect(el.style.left).toBe('54px'); // half width + edge
    expect(el.style.top).toBe('44px'); // height + edge
    expect(el.style.getPropertyValue('--tail')).toBe('-40px'); // towards x = 10, short of the corner
    bubble.move(295, 100);
    expect(el.style.left).toBe('246px');
  });

  it('answers once and closes on a click', () => {
    const { host, bubble } = setup();
    const answer = vi.fn();
    bubble.show('q', 0, 0, answer);
    const [yes, no] = buttons(host);
    yes.click();
    no.click(); // already closed: no second answer
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(true);
    expect(host.querySelector<HTMLElement>('.quiz-bubble')!.hidden).toBe(true);
  });

  it('answers no', () => {
    const { host, bubble } = setup();
    const answer = vi.fn();
    bubble.show('q', 0, 0, answer);
    buttons(host)[1].click();
    expect(answer).toHaveBeenCalledWith(false);
  });

  it('hide drops a pending answer', () => {
    const { host, bubble } = setup();
    const answer = vi.fn();
    bubble.show('q', 0, 0, answer);
    bubble.hide();
    buttons(host)[0].click();
    expect(answer).not.toHaveBeenCalled();
  });

  it('destroy removes it from the host', () => {
    const { host, bubble } = setup();
    bubble.destroy();
    expect(host.querySelector('.quiz-bubble')).toBeNull();
  });
});
