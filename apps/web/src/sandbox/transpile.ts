/**
 * TypeScript support: strip the types in the app, then run the result through
 * the normal JavaScript worker. Sucrase is a syntax-only transform (no type
 * checking, no libraries), which is exactly the contract for a code exercise.
 * It is imported lazily so JavaScript-only sessions never pay for it.
 */
export async function transpileTypeScript(programs: readonly string[]): Promise<string[]> {
  if (programs.length === 0) return [];
  let transform: typeof import('sucrase').transform;
  try {
    ({ transform } = await import('sucrase'));
  } catch (error) {
    throw new Error(`The TypeScript compiler could not be loaded: ${messageOf(error)}`);
  }

  return programs.map((program, index) => {
    try {
      return transform(program, {
        transforms: ['typescript'],
        filePath: `case-${index + 1}.ts`,
      }).code;
    } catch (error) {
      throw new Error(`TypeScript could not be compiled (test ${index + 1}): ${messageOf(error)}`);
    }
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
