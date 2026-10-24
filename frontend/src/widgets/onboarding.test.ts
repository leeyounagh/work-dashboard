// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissWelcome, markNewWorkspace, renderWelcome, showsWelcome } from './onboarding';

beforeEach(() => localStorage.clear());

describe('first-run welcome', () => {
  it('shows only for workspaces created here, until dismissed', () => {
    expect(showsWelcome('ws-a')).toBe(false); // existing workspaces never see it
    markNewWorkspace('ws-a');
    expect(showsWelcome('ws-a')).toBe(true);
    expect(showsWelcome('ws-b')).toBe(false);
    dismissWelcome('ws-a');
    expect(showsWelcome('ws-a')).toBe(false);
  });

  it('offers widget management and closing', () => {
    const manage = vi.fn();
    const close = vi.fn();
    const el = renderWelcome(manage, close);
    expect(el.textContent).toContain('위젯 관리');
    const [manageBtn, closeBtn] = el.querySelectorAll('button');
    manageBtn.click();
    closeBtn.click();
    expect(manage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('works when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(showsWelcome('ws-a')).toBe(false);
    spy.mockRestore();
  });
});
