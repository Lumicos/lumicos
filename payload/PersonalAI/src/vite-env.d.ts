/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" enables the in-browser demo provider (npm run dev:mock). */
  readonly VITE_ENABLE_MOCK?: string;
}

/** Hash of src/** when this page was built/started (see server/util/buildInfo.mjs). */
declare const __LUMICOS_SRC_BUILD__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
