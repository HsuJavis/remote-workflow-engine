// DES-265 (ARCH-184, TASK-261): `resolveOpenrouterKey` lifted out of pi-gateway-client.ts as a pure
// function — body moved verbatim from that file's former private helper (pi-gateway-client.ts:528-530
// pre-v40). Resolution order: secretSource.resolve('OPENROUTER_API_KEY') -> RWE_SECRET_OPENROUTER_API_KEY
// env -> OPENROUTER_API_KEY env -> undefined. The key this returns is passed only as pi-ai's
// `options.apiKey` — never `model.headers`, never logged.
import type { SecretSource } from '../secret-resolver.js';

export function resolveOpenrouterKey(secretSource: SecretSource): string | undefined {
  return secretSource.resolve('OPENROUTER_API_KEY') ?? process.env['RWE_SECRET_OPENROUTER_API_KEY'] ?? process.env['OPENROUTER_API_KEY'];
}
