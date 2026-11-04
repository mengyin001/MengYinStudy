import type { ImporterRuntime, QuestionTypeRuntime } from './types';

export interface RegistryEntry<T> {
  item: T;
  pluginId: string;
}

/**
 * Tiny extension registry. Later registrations win so a user-installed plugin
 * can override a bundled question type with the same id.
 */
export class ExtensionRegistry<T extends { id: string }> {
  private readonly items = new Map<string, RegistryEntry<T>>();

  register(item: T, pluginId: string): void {
    this.items.set(item.id, { item, pluginId });
  }

  get(id: string): T | undefined {
    return this.items.get(id)?.item;
  }

  entry(id: string): RegistryEntry<T> | undefined {
    return this.items.get(id);
  }

  list(): RegistryEntry<T>[] {
    return [...this.items.values()];
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  removeByPlugin(pluginId: string): void {
    for (const [id, entry] of this.items) {
      if (entry.pluginId === pluginId) this.items.delete(id);
    }
  }

  clear(): void {
    this.items.clear();
  }
}

export type QuestionTypeRegistry = ExtensionRegistry<QuestionTypeRuntime>;
export type ImporterRegistry = ExtensionRegistry<ImporterRuntime>;

export function createQuestionTypeRegistry(): QuestionTypeRegistry {
  return new ExtensionRegistry<QuestionTypeRuntime>();
}

export function createImporterRegistry(): ImporterRegistry {
  return new ExtensionRegistry<ImporterRuntime>();
}
