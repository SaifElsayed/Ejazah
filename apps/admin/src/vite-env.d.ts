/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin; the panel calls its administrator surface under `/admin/trpc` (T037). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
