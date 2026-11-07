import { describe, expect, it } from 'vitest';
import { isUniqueViolation, isMissingColumn } from './compat';

describe('isMissingColumn', () => {
  it('detects a Postgres undefined-column error', () => {
    expect(
      isMissingColumn(
        { code: '42703', message: 'column "exam_minutes" of relation "user_decks" does not exist' },
        'exam_minutes',
      ),
    ).toBe(true);
  });

  it('detects a PostgREST schema-cache error', () => {
    expect(
      isMissingColumn(
        {
          code: 'PGRST204',
          message:
            "Could not find the 'exam_minutes' column of 'user_decks' in the schema cache",
        },
        'exam_minutes',
      ),
    ).toBe(true);
  });

  it('does not hide unrelated errors', () => {
    expect(isMissingColumn({ message: 'permission denied for table user_decks' }, 'exam_minutes')).toBe(
      false,
    );
    expect(isMissingColumn({ message: 'column "other" does not exist' }, 'exam_minutes')).toBe(false);
    expect(isMissingColumn('network timeout', 'exam_minutes')).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('detects the unique-key error a racing writer produces', () => {
    expect(
      isUniqueViolation({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "user_decks_user_client_unique"',
      }),
    ).toBe(true);
  });

  it('does not swallow other failures', () => {
    expect(isUniqueViolation({ message: 'permission denied for table user_decks' })).toBe(false);
    expect(isUniqueViolation('network timeout')).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});