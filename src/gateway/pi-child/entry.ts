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
import { spawn } from 'node:child_process';
import { runPiChildSession } from './session-runner.ts';
import { buildBashEnv, isWrapped } from './bash-env.ts';
import { isPathContained, resolveLanding } from '../../path-containment.ts';
import { resolveRipgrepOverride } from './ripgrep-override.ts';
import { runPiPathProbe } from './pi-path-probe.ts';
import type { PiChildConfig, PiChildEvent } from './protocol.ts';

// Composition, per the "rwe sandbox child .ts imports" memory note: session-runner.ts (which gets
// full tsc coverage, unlike this file) cannot import these two directly — each is reached through a
// LOCAL sibling `.ts` file, which breaks under this process's raw-node loading the moment the
// importING file itself is not also loaded by an explicit `.ts` specifier. bash-env.ts and
// path-containment.ts both hold zero local imports of their own, so loading them HERE, by explicit
// `.ts` extension, is safe — they are then passed down as plain function parameters (dependency
// injection), never imported a second time inside session-runner.ts.
const deps = { isPathContained, buildBashEnv, isWrapped, resolveLanding };

function emit(event: PiChildEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

/** `entry.ts --probe`: the pi-path confinement boot probe (spec "Confinement posture"), run as its
 *  OWN short-lived child so srt's process-global state never touches the long-lived engine. Prints
 *  ONE JSON line (`PiPathProbeResult`-shaped) to stdout and exits — never reads stdin. */
async function runProbe(): Promise<void> {
  const result = await runPiPathProbe(
    { isWrapped },
    (argv, env) => new Promise((resolvePromise) => {
      const child = spawn(argv[0]!, argv.slice(1), { env, stdio: 'ignore' });
      child.once('exit', (code) => resolvePromise(code));
      child.once('error', () => resolvePromise(null));
    }),
    resolveRipgrepOverride,
  );
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv.includes('--probe')) {
    await runProbe();
    return;
  }
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
    await runPiChildSession(config, emit, deps);
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
