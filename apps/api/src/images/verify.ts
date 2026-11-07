/**
 * Multimodal check for generated photos.
 *
 * A diffusion model sometimes returns a picture that is merely on-topic: the
 * question asks about a closed book, the picture shows an open one, or the
 * picture itself contains the answer. When the selected provider also serves a
 * vision model, the finished picture is sent back with the question and the
 * answer, and a mismatch drops the picture instead of shipping it.
 *
 * Diagrams are not checked here: they are drawn from a validated spec that the
 * same model wrote from the question, so a second model would only re-read the
 * same data. Their correctness is enforced by the spec validator and renderer.
 *
 * The check is best-effort. A provider failure counts as "not checked" and
 * never fails the deck; an image is only dropped on an explicit mismatch.
 */
import type { Question } from '@mengyin/core';
import type { Env } from '../env';
import { parseJsonLoose } from '../providers/chat';
import type { ResolvedProvider } from '../providers/registry';
import { answerSummary } from '../generation/illustration-brief';

export interface VisionCheck {
  checked: boolean;
  ok: boolean;
  reason?: string;
}

const UNCHECKED: VisionCheck = { checked: false, ok: true };
const TIMEOUT_MS = 30_000;

/** The vision model configured for this provider, if any. */
export function visionModelFor(env: Env, providerId: string): string | null {
  if ((env.AI_VERIFY_IMAGES ?? '').trim().toLowerCase() === 'off') return null;
  const varName = providerId === 'glm' ? 'GLM_VISION_MODEL' : providerId === 'deepseek' ? 'DEEPSEEK_VISION_MODEL' : '';
  const value = varName ? (env[varName as keyof Env] as string | undefined) ?? '' : '';
  return value.trim() || null;
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  return `${base}/chat/completions`;
}

function checkPrompt(question: Question, clue: boolean): string {
  const options = (question.options ?? []).map((option) => `${option.id}: ${option.text}`).join('\n');
  const rule = clue
    ? 'The learner must identify what is shown. The picture is the clue and may depict the answer; reject it only if it is unrelated, shows a different subject, or contains text that names the answer.'
    : 'The picture must not reveal the answer.';
  return [
    'You check one illustration for a practice question. The learner must be able to answer from the question text alone, and the picture must support the question without unrelated content.',
    `Question: ${question.prompt}`,
    options ? `Options:\n${options}` : '',
    `Correct answer: ${answerSummary(question) || '(open answer)'}`,
    rule,
    'Look at the image and answer: does it show the situation described by the question?',
    'Reply with ONE JSON object: {"matches": true|false, "reason": "at most 20 words"}.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Ask the provider's vision model whether a photo fits its question. Never
 * throws: every failure is reported as "not checked".
 */
export async function verifyIllustration(
  env: Env,
  provider: ResolvedProvider,
  question: Question,
  image: string,
  fetchImpl: typeof fetch = fetch,
  options: { clue?: boolean } = {},
): Promise<VisionCheck> {
  const model = visionModelFor(env, provider.id);
  if (!model) return UNCHECKED;
  if (!provider.apiKey || provider.demo) return UNCHECKED;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint(provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 160,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: checkPrompt(question, options.clue === true) },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return UNCHECKED;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text.trim()) return UNCHECKED;
    const parsed = parseJsonLoose(text) as { matches?: unknown; reason?: unknown };
    if (typeof parsed?.matches !== 'boolean') return UNCHECKED;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '';
    return {
      checked: true,
      ok: parsed.matches,
      ...(reason ? { reason } : {}),
    };
  } catch {
    return UNCHECKED;
  } finally {
    clearTimeout(timer);
  }
}
