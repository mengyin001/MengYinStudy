import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUESTION_SKILL, QUESTION_SKILL_VERSION } from './skill';

describe('question authoring skill', () => {
  it('states the contract the validator enforces', () => {
    expect(QUESTION_SKILL).toContain('"questions"');
    expect(QUESTION_SKILL).toContain('{{blank}}');
    expect(QUESTION_SKILL).toContain('"kind": "custom"');
    expect(QUESTION_SKILL).toContain('untrusted data');
    expect(QUESTION_SKILL).toContain('JavaScript');
  });

  it('keeps docs/QUESTION_AUTHORING_SKILL.md in sync', () => {
    const doc = fs.readFileSync(
      new URL('../../../../docs/QUESTION_AUTHORING_SKILL.md', import.meta.url),
      'utf8',
    );
    expect(doc).toContain(`Version ${QUESTION_SKILL_VERSION}`);
    expect(doc).toContain(QUESTION_SKILL.trim());
  });
});
