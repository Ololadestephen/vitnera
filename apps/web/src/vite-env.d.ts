/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOTCHAIN_RPC_URL?: string;
  readonly VITE_BOTCHAIN_CHAIN_ID?: string;
  readonly VITE_VITNERA_CONTRACT?: `0x${string}`;
  readonly VITE_STORAGE_API_URL?: string;
  readonly VITE_REVIEWER_API_URL?: string;
  readonly VITE_DEPLOYMENT_BLOCK?: string;
}
