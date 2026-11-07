import { describe, expect, it } from 'vitest';
import { createRefreshGuard } from './refreshGuard';

describe('cloud list refresh guard', () => {
  it('accepts a reply when nothing happened since it started', () => {
    const guard = createRefreshGuard();
    const token = guard.begin();
    expect(guard.accept(token)).toBe(true);
  });

  it('drops a reply that a delete invalidated', () => {
    const guard = createRefreshGuard();
    const token = guard.begin();
    guard.invalidate();
    expect(guard.accept(token)).toBe(false);
  });

  it('drops the older reply when a newer refresh starts', () => {
    const guard = createRefreshGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.accept(first)).toBe(false);
    expect(guard.accept(second)).toBe(true);
  });

  it('accepts the refresh that runs after the write', () => {
    const guard = createRefreshGuard();
    guard.begin();
    guard.invalidate();
    const after = guard.begin();
    expect(guard.accept(after)).toBe(true);
  });
});
