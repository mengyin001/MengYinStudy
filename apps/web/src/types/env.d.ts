/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_OFFICIAL_SYNC_MINUTES?: string;
  /** Absolute API base for the desktop shell or a separately hosted web build. */
  readonly VITE_AI_API_BASE?: string;
  /** Local dev proxy target for /api, e.g. http://127.0.0.1:8787. */
  readonly VITE_AI_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
