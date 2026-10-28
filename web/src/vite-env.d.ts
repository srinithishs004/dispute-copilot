/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_JUDGE_EMAIL?: string;
  readonly VITE_JUDGE_PASSWORD?: string;
  readonly VITE_SANDBOX_BUYER_EMAIL?: string;
  readonly VITE_SANDBOX_BUYER_PASSWORD?: string;
  readonly VITE_AG_STUDIO_LICENSE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
