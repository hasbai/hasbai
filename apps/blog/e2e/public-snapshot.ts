// E2E fixture resets must be visible immediately. This module is aliased only in mode=e2e.
import { originSnapshot } from "../src/lib/server/public-snapshot";
export {
  snapshotKey,
  PublicCacheError,
} from "../src/lib/server/public-snapshot";
export type {
  PublicSnapshot,
  PublicRow,
} from "../src/lib/server/public-snapshot";
export const publicSnapshot = (_env?: App.Platform["env"]) => originSnapshot();
export const refreshPublicSnapshot = async (
  _env?: App.Platform["env"],
  ..._args: unknown[]
) => {};
