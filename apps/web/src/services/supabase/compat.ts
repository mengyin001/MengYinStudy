/**
 * Small compatibility helpers for talking to a Supabase project whose SQL
 * migrations are older than the app.
 *
 * A missing column is a schema problem, not a transport problem: the query
 * fails, but retrying the same read/write without that column keeps the older
 * data usable. This matters during a rolling upgrade — a learner can open the
 * new web build before the migration has been applied.
 */

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return [record.message, record.details, record.hint, record.code]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ');
}

/**
 * True when PostgREST/Postgres rejected a query because `column` is not in the
 * schema yet. Matches both common shapes:
 * - `column "exam_minutes" of relation "user_decks" does not exist`
 * - `Could not find the 'exam_minutes' column of 'user_decks' in the schema cache`
 */
export function isMissingColumn(error: unknown, column: string): boolean {
  const text = errorText(error);
  if (!text.toLowerCase().includes(column.toLowerCase())) return false;
  return /does not exist|could not find|schema cache|undefined column|42703|PGRST204/i.test(text);
}
