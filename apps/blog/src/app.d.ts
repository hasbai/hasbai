declare global {
  namespace App {
    interface Platform {
      env: Env;
      context: ExecutionContext;
      caches: CacheStorage;
    }
  }
}
export {};
