/** Cloudflare Worker environment. Secrets are injected by Wrangler; none are VITE_ vars. */

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  /** Static site binding: the Worker serves the built Vite app and the API. */
  ASSETS?: AssetsBinding;

  /** Workers AI binding for free text-to-image generation. */
  AI?: AiBinding;
  /** Optional KV namespace for per-account daily quotas. */
  AI_QUOTA?: KvNamespaceLike;

  // -- Text providers -------------------------------------------------------
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_MODELS?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_THINKING?: string;
  DEEPSEEK_REASONING_EFFORT?: string;

  /**
   * `off` switches AI question generation off server-side without deleting a
   * provider key: the catalogue is empty and every generation call fails before
   * a provider is contacted. Unset (or any other value) keeps it on.
   */
  AI_GENERATION?: string;

  AI_DEFAULT_PROVIDER?: string;
  AI_DEFAULT_MODEL?: string;
  AI_TEMPERATURE?: string;
  AI_MAX_TOKENS?: string;
  AI_TIMEOUT_MS?: string;
  AI_JSON_MODE?: string;
  AI_ALLOW_CUSTOM_MODELS?: string;

  /** Demo provider for local development without any provider key. */
  AI_MOCK?: string;

  // -- Image provider -------------------------------------------------------
  IMAGE_PROVIDER?: string;
  IMAGE_MODEL?: string;
  /** Comma-separated allowlist of selectable image models. */
  IMAGE_MODELS?: string;
  IMAGE_STEPS?: string;
  IMAGE_SEED?: string;

  // -- Web image search -----------------------------------------------------
  /** `wikimedia` (default) or `off`. Real reference photos for scene questions. */
  IMAGE_SEARCH?: string;
  IMAGE_SEARCH_LIMIT?: string;
  IMAGE_SEARCH_TIMEOUT_MS?: string;

  /**
   * ECDSA P-256 keypair used to attest generated photos. Both values are
   * optional; without them images are stored without a signature.
   * Generate with `npm run image:keys` (PKCS8 / SPKI, base64).
   */
  IMAGE_SIGNING_KEY?: string;
  IMAGE_VERIFY_KEY?: string;

  /** Optional vision model per provider, used to check a generated photo. */
  DEEPSEEK_VISION_MODEL?: string;
  /** `off` disables the multimodal check even when a vision model is set. */
  AI_VERIFY_IMAGES?: string;

  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_TOKEN?: string;

  // -- Access control -------------------------------------------------------
  AUTH_REQUIRED?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  ALLOWED_ORIGINS?: string;

  // -- Quotas ---------------------------------------------------------------
  AI_DAILY_QUESTIONS?: string;
  AI_DAILY_IMAGES?: string;

  // -- Billing --------------------------------------------------------------
  /**
   * `false` disables plan enforcement for an intentional off-line demo.
   * Defaults to `true` whenever Supabase is configured: generation must not
   * trust a client-side plan, and the free question quota/refunds are enforced
   * server-side.
   */
  BILLING_ENFORCE?: string;
  /** Secret key used by the webhook and the admin RPCs. Never in the browser. */
  SUPABASE_SERVICE_KEY?: string;
  /** Older name for the same secret, used by the local tooling. */
  SUPABASE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Public site origin used for Checkout success/cancel and the portal. */
  APP_URL?: string;
  /** Stripe price ids, one per paid plan and interval. */
  STRIPE_PRICE_LIGHT_MONTH?: string;
  STRIPE_PRICE_LIGHT_YEAR?: string;
  STRIPE_PRICE_STANDARD_MONTH?: string;
  STRIPE_PRICE_STANDARD_YEAR?: string;
  STRIPE_PRICE_PRO_MONTH?: string;
  STRIPE_PRICE_PRO_YEAR?: string;
}
