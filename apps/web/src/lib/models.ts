import { SUPPORTED_MODELS } from '@mengyin/core';
import type { AiProviderInfo } from '@mengyin/ai-contract';

/** Human names for the three models this release sells. */
const LABELS: Record<string, string> = {
  'glm-4.7-flash': 'GLM-4.7',
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  demo: 'Demo',
};

export function modelLabel(id: string): string {
  return LABELS[id] ?? id;
}

export interface ModelChoice {
  model: string;
  providerId: string;
  providerLabel: string;
  /** The server holds a key for this provider. */
  configured: boolean;
}

/**
 * Flatten the provider catalogue into one list, in the product's model order.
 * The Generate page shows these directly so the learner picks a model in one
 * step instead of choosing a provider first.
 */
export function modelChoices(providers: readonly AiProviderInfo[]): ModelChoice[] {
  const choices: ModelChoice[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      if (!provider.demo && !(SUPPORTED_MODELS as readonly string[]).includes(model)) continue;
      choices.push({
        model,
        providerId: provider.id,
        providerLabel: provider.label,
        configured: provider.configured,
      });
    }
  }
  const order = new Map<string, number>(
    SUPPORTED_MODELS.map((model, index) => [model, index]),
  );
  return choices.sort(
    (left, right) => (order.get(left.model) ?? 99) - (order.get(right.model) ?? 99),
  );
}

/** Which provider serves a model, using the same catalogue. */
export function providerForModel(
  providers: readonly AiProviderInfo[],
  model: string,
): AiProviderInfo | undefined {
  return providers.find((candidate) => candidate.models.includes(model));
}
