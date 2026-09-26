/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the ClauseGuard API. Defaults to the dev-server proxy path. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
