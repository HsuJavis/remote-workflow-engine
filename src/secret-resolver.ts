// Pure SecretResolver (DES-025 / ARCH-016 / TASK-030): resolveConfig (atomic all-or-nothing) +
// redact (capture-time choke point). Imports no fs/net/process — the source is preloaded and
// injected (TASK-031 loads it at startup from systemd LoadCredential / process env).

export interface SecretSource {
  resolve(handle: string): string | undefined;
  names(): string[];
}

/** Test/composition fake: a preloaded name -> value map, no I/O. */
export class InMemorySecretSource implements SecretSource {
  constructor(private readonly _map: Record<string, string>) {}
  resolve(handle: string): string | undefined {
    return this._map[handle];
  }
  names(): string[] {
    return Object.keys(this._map);
  }
}

export class SecretMissingError extends Error {
  readonly code = 'SECRET_MISSING' as const;
  constructor(name: string) {
    super(`Secret not found for handle: ${name}`);
    this.name = 'SecretMissingError';
  }
}

export class SecretHandleInvalidError extends Error {
  readonly code = 'SECRET_HANDLE_INVALID' as const;
  constructor(raw: string) {
    super(`Malformed secret handle grammar: ${raw}`);
    this.name = 'SecretHandleInvalidError';
  }
}

// Broad matcher first (to catch malformed names for a typed error, never a literal pass-through),
// then the strict name grammar validates the captured body.
const HANDLE_ANY = /\$\{secret:([^}]*)\}/g;
const HANDLE_NAME = /^[A-Za-z0-9_.-]+$/;

function collectHandleNames(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    HANDLE_ANY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLE_ANY.exec(value))) {
      const raw = m[1];
      if (!HANDLE_NAME.test(raw)) throw new SecretHandleInvalidError(m[0]);
      out.push(raw);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectHandleNames(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectHandleNames(v, out);
  }
}

function substituteHandles(value: unknown, source: SecretSource): unknown {
  if (typeof value === 'string') {
    HANDLE_ANY.lastIndex = 0;
    return value.replace(HANDLE_ANY, (_full, name: string) => source.resolve(name) as string);
  }
  if (Array.isArray(value)) return value.map((v) => substituteHandles(v, source));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substituteHandles(v, source);
    return out;
  }
  return value;
}

/** PURE — atomic all-or-nothing: every `${secret:name}` handle in `config` is validated and
 *  resolved BEFORE anything is substituted. A mixed good/missing config throws SECRET_MISSING and
 *  resolves nothing partial; a malformed handle grammar throws SECRET_HANDLE_INVALID rather than
 *  smuggling the literal placeholder through as a value. */
export function resolveConfig(config: unknown, source: SecretSource): unknown {
  const names: string[] = [];
  collectHandleNames(config, names);
  for (const name of names) {
    if (source.resolve(name) === undefined) throw new SecretMissingError(name);
  }
  return substituteHandles(config, source);
}

/** PURE — capture-time redaction: replaces every occurrence of any resolved secret value
 *  (including split across nested fields) with the redaction marker. Handle NAMES are never
 *  touched — only resolved values are passed in here. */
export function redact(event: unknown, secretValues: string[]): unknown {
  const values = secretValues.filter((v) => v.length > 0);
  function walk(value: unknown): unknown {
    if (typeof value === 'string') {
      let out = value;
      for (const v of values) out = out.split(v).join('‹redacted›');
      return out;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return value;
  }
  return walk(event);
}
