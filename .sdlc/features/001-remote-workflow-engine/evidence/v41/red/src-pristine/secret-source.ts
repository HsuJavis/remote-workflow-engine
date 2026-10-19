// Secret source loader (DES-025 / ARCH-016 / TASK-031): thin adapter loading `${secret:name}`
// values from process env into a parent-memory map at startup. Synchronous, no async/vault impl
// until a real second backend exists (Karpathy — no speculative flexibility). Composes with the
// pure SecretSource port (TASK-030's src/secret-resolver.ts) the resolver/builder consume.
import type { SecretSource } from './secret-resolver.js';

const ENV_PREFIX = 'RWE_SECRET_';

/** Loads every `RWE_SECRET_<NAME>` env var present at call time into a resolvable SecretSource
 *  keyed by `<NAME>` (prefix stripped). An unset/never-loaded name resolves to `undefined` — never
 *  a hang or a throw (DES-025 boundary/error). */
export function loadSecretSourceFromEnv(): SecretSource {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(ENV_PREFIX) && value !== undefined) {
      map[key.slice(ENV_PREFIX.length)] = value;
    }
  }
  return {
    resolve(handle: string): string | undefined {
      return map[handle];
    },
    names(): string[] {
      return Object.keys(map);
    },
  };
}
