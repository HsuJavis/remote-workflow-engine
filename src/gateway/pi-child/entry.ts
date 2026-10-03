// pi harness v1 child entry point. Executed in its own OS process (spawned by PiGatewayClient, one
// per dispatch) by `node --experimental-transform-types` — same convention as
// src/sandbox/child-entry.ts (NOT resolved by tsx's bundler-mode `.js`->`.ts` rewriting), so, like
// that file, every local import here uses an explicit `.ts` extension, and the files it reaches
// (session-runner.ts, protocol.ts) hold no further *value* imports of their own (protocol.ts is
// type-only — see its own header comment) — see the "rwe sandbox child .ts imports" memory note.
//
// Protocol: reads exactly ONE line of JSON (a PiChildConfig) from stdin, then streams PiChildEvent
// JSONL to stdout as the session progresses, then exits. Holds a provider API key in memory only
// (owner decision 3) — never logs `config` verbatim (it may carry one).
import { createInterface } from 'node:readline';
import { runPiChildSession } from './session-runner.ts';
import type { PiChildConfig, PiChildEvent } from './protocol.ts';

function emit(event: PiChildEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  const firstLine = await new Promise<string | undefined>((resolve) => {
    rl.once('line', (line) => resolve(line));
    rl.once('close', () => resolve(undefined));
  });
  rl.close();
  if (firstLine === undefined) {
    emit({ t: 'fatal', message: 'INTERNAL_ERROR: pi child received no config on stdin' });
    process.exit(1);
  }
  let config: PiChildConfig;
  try {
    config = JSON.parse(firstLine) as PiChildConfig;
  } catch (err) {
    emit({ t: 'fatal', message: `INTERNAL_ERROR: pi child could not parse its own config: ${err instanceof Error ? err.message : String(err)}` });
    process.exit(1);
  }
  emit({ t: 'ready' });
  try {
    await runPiChildSession(config, emit);
  } catch (err) {
    // A throw here is a programming defect inside session-runner.ts (it is documented to convert
    // every dispatch-shaped failure into an {t:'error'} event itself) — surfaced as 'fatal' so the
    // parent never mistakes it for an ordinary provider failure it should classify/retry.
    emit({ t: 'fatal', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exit(1);
  }
  process.exit(0);
}

void main();
