import { describe, expect, it } from 'vitest';
import { transpileTypeScript } from './transpile';

describe('TypeScript transpile', () => {
  it('removes type annotations and keeps runtime code', async () => {
    const [program] = await transpileTypeScript([
      'const total: number = [1, 2].reduce((a: number, b: number) => a + b, 0);\nconsole.log(total);',
    ]);
    expect(program).toContain('const total = [1, 2].reduce((a, b) => a + b, 0);');
    expect(program).not.toContain(': number');
  });

  it('names the broken test when a snippet is not valid TypeScript', async () => {
    await expect(transpileTypeScript(['const = ;'])).rejects.toThrow(/test 1/i);
  });
});
