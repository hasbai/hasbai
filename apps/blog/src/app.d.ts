declare global {
  namespace App {
    interface Platform {
      env: Env & { AIG_TRANSLATE_RUN_TOKEN?: string };
      context: ExecutionContext;
      caches: CacheStorage;
    }
  }
}
export {};
