import { createImporterRegistry, createQuestionTypeRegistry } from '@mengyin/plugin-sdk';
import type { MessageKey, Translate } from '@/i18n/messages';

/** Process-wide extension registries. Built-in types are registered first. */
export const questionTypes = createQuestionTypeRegistry();
export const importers = createImporterRegistry();

const BUILTIN_IDS = ['single', 'multi', 'boolean', 'fill', 'short', 'code'] as const;

let builtinsRegistered = false;

export function registerBuiltinQuestionTypes(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  const builtins = [
    { id: 'single', label: 'Multiple choice', rendererKind: 'choice' as const, check: () => null },
    { id: 'multi', label: 'Select all that apply', rendererKind: 'multichoice' as const, check: () => null },
    { id: 'boolean', label: 'True or false', rendererKind: 'choice' as const, check: () => null },
    { id: 'fill', label: 'Fill in the blank', rendererKind: 'text' as const, check: () => null },
    { id: 'short', label: 'Short answer', rendererKind: 'text' as const, check: () => null },
  ];
  for (const definition of builtins) questionTypes.register(definition, 'builtin');
}

/** Localised label: built-in types come from i18n, plugin types from their manifest. */
export function questionTypeLabel(typeId: string, t: Translate): string {
  if ((BUILTIN_IDS as readonly string[]).includes(typeId)) {
    return t(`type.${typeId}` as MessageKey);
  }
  return questionTypes.get(typeId)?.label ?? typeId;
}
