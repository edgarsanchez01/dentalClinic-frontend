/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL publica del backend. Sin secretos: esto se incrusta en el bundle. */
  readonly VITE_API_BASE_URL?: string;
  /** Destino del proxy de Vite en desarrollo. */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}