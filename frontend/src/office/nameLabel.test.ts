import { describe, expect, it } from 'vitest';
import { nameLabel } from './agentState';

describe('nameLabel', () => {
  it('shows Claude/Shell for default titles and custom names as they are', () => {
    expect(nameLabel('Claude · 그룹웨어')).toBe('Claude');
    expect(nameLabel('Shell · 선내운영')).toBe('Shell');
    expect(nameLabel('휴가 기능')).toBe('휴가 기능');
  });
});
