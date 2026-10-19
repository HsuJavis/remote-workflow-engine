// v40 (DES-266, ARCH-187/183, TASK-262): pure input layer for decide()/generateImage() — no fs/
// network. Every rejection throws `codedError` with the triggering error code's name embedded in
// `.message` (matches the rest of the codebase's `codedError` convention, e.g. `audited-read.ts`),
// so `toThrow(/CODE/)` at the call site works without a separate lookup.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { codedError } from '../errors.js';
import type { CallKey, DecideAnswer, DecideQuestion, PrimitiveKind } from '../types.js';

type JsonObject = Record<string, unknown>;

export const MAX_DECIDE_QUESTIONS = 32;
export const MAX_DECIDE_STATE_BYTES = 131_072;
export const MAX_IMAGE_PROMPT_BYTES = 16_384;
export const MAX_INPUT_IMAGES = 4;
export const MAX_OUTDIR_BYTES = 255;

const QUESTION_ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Structural-only field path (never a value, never a key drawn from `state`) — the one thing every
 *  `PRIMITIVE_INPUT_INVALID` message is allowed to name beyond the fixed `fieldPath`/`rule` shape. */
function invalid(kindWord: 'decide' | 'generateImage', label: string, fieldPath: string, rule: string): never {
  throw codedError('PRIMITIVE_INPUT_INVALID', `PRIMITIVE_INPUT_INVALID: ${kindWord} '${label}': ${fieldPath} ${rule}`);
}

function pathRefused(reason: 'escape' | 'not_regular' | 'too_large' | 'unsupported_type', detail: string): never {
  throw codedError('IMAGE_PATH_REFUSED', `IMAGE_PATH_REFUSED: generateImage: ${detail} ${reason}`, { reason });
}

function isPlainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function assertClosedKeys(label: string, kindWord: 'decide' | 'generateImage', opts: JsonObject, allowed: readonly string[]): void {
  for (const k of Object.keys(opts)) {
    if (!allowed.includes(k)) invalid(kindWord, label, k, 'is not a recognized argument');
  }
}

function validateQuestion(label: string, id: string, q: unknown): DecideQuestion {
  if (!QUESTION_ID_RE.test(id)) invalid('decide', label, `questions.${id}`, 'is not a valid question id');
  if (!isPlainObject(q)) invalid('decide', label, `questions.${id}`, 'must be an object');
  const instructions = q['instructions'];
  if (typeof instructions !== 'string' || instructions.length === 0) {
    invalid('decide', label, `questions.${id}.instructions`, 'must be a non-empty string');
  }
  const type = q['type'];
  if (type === 'bool') {
    const criteria = q['criteria'];
    if (!isPlainObject(criteria) || Object.keys(criteria).length !== 2
      || typeof criteria['true'] !== 'string' || typeof criteria['false'] !== 'string') {
      invalid('decide', label, `questions.${id}.criteria`, 'must be exactly {true, false}');
    }
    return { type: 'bool', instructions, criteria: { true: String((criteria as JsonObject)['true']), false: String((criteria as JsonObject)['false']) } };
  }
  if (type === 'choice') {
    const criteria = q['criteria'];
    if (!isPlainObject(criteria) || Object.keys(criteria).filter((k) => typeof criteria[k] === 'string').length < 2) {
      invalid('decide', label, `questions.${id}.criteria`, 'must have at least 2 string-valued entries');
    }
    return { type: 'choice', instructions, criteria: criteria as Record<string, string> };
  }
  if (type === 'score') {
    const criteria = q['criteria'];
    if (!Array.isArray(criteria) || criteria.filter((c) => typeof c === 'string').length < 2) {
      invalid('decide', label, `questions.${id}.criteria`, 'must have at least 2 string entries');
    }
    return { type: 'score', instructions, criteria: criteria as string[] };
  }
  invalid('decide', label, `questions.${id}.type`, "must be 'bool', 'choice', or 'score'");
}

export function validateDecideInput(label: string, opts: unknown): { state: JsonObject; questions: Record<string, DecideQuestion> } {
  if (!isPlainObject(opts)) invalid('decide', label, 'opts', 'must be an object');
  assertClosedKeys(label, 'decide', opts, ['state', 'questions']);
  const state = opts['state'];
  if (!isPlainObject(state)) invalid('decide', label, 'state', 'must be an object');
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_DECIDE_STATE_BYTES) {
    invalid('decide', label, 'state', `exceeds ${MAX_DECIDE_STATE_BYTES} bytes`);
  }
  const questionsRaw = opts['questions'];
  if (!isPlainObject(questionsRaw)) invalid('decide', label, 'questions', 'must be an object');
  const ids = Object.keys(questionsRaw);
  if (ids.length < 1 || ids.length > MAX_DECIDE_QUESTIONS) {
    invalid('decide', label, 'questions', `must have between 1 and ${MAX_DECIDE_QUESTIONS} entries`);
  }
  const questions: Record<string, DecideQuestion> = {};
  for (const id of ids) questions[id] = validateQuestion(label, id, questionsRaw[id]);
  return { state, questions };
}

export function validateImageInput(label: string, opts: unknown): { prompt: string; inputImages: string[]; outDir: string | undefined } {
  if (!isPlainObject(opts)) invalid('generateImage', label, 'opts', 'must be an object');
  assertClosedKeys(label, 'generateImage', opts, ['prompt', 'inputImages', 'outDir']);
  const prompt = opts['prompt'];
  if (typeof prompt !== 'string' || prompt.length === 0) invalid('generateImage', label, 'prompt', 'must be a non-empty string');
  if (Buffer.byteLength(prompt) > MAX_IMAGE_PROMPT_BYTES) invalid('generateImage', label, 'prompt', `exceeds ${MAX_IMAGE_PROMPT_BYTES} bytes`);

  const inputImagesRaw = opts['inputImages'];
  let inputImages: string[] = [];
  if (inputImagesRaw !== undefined) {
    if (!Array.isArray(inputImagesRaw) || inputImagesRaw.some((p) => typeof p !== 'string')) {
      invalid('generateImage', label, 'inputImages', 'must be an array of strings');
    }
    if (inputImagesRaw.length > MAX_INPUT_IMAGES) invalid('generateImage', label, 'inputImages', `must have at most ${MAX_INPUT_IMAGES} entries`);
    inputImages = inputImagesRaw as string[];
  }

  const outDirRaw = opts['outDir'];
  let outDir: string | undefined;
  if (outDirRaw !== undefined) {
    if (typeof outDirRaw !== 'string' || outDirRaw.length === 0) invalid('generateImage', label, 'outDir', 'must be a non-empty string');
    if (Buffer.byteLength(outDirRaw) > MAX_OUTDIR_BYTES) invalid('generateImage', label, 'outDir', `exceeds ${MAX_OUTDIR_BYTES} bytes`);
    assertOutDirContained(outDirRaw);
    outDir = outDirRaw;
  }
  return { prompt, inputImages, outDir };
}

/** Rejects (IMAGE_PATH_REFUSED, reason 'escape') any outDir that could resolve outside the
 *  workspace — checked on the RAW string (never `path.normalize`d first: `normalize('a/../b')`
 *  collapses to `'b'`, which would silently hide the escape). A lone `'.'` segment (anywhere,
 *  including the whole string) is the one allowed dot-form. */
function assertOutDirContained(outDir: string): void {
  if (outDir.startsWith('/')) pathRefused('escape', 'outDir');
  for (const segment of outDir.split('/')) {
    if (segment !== '.' && segment.startsWith('.')) pathRefused('escape', 'outDir');
  }
}

/** Posix-normalizes and strips a trailing '/' — `'out/ig'`, `'out/ig/'`, and `'./out/ig'` all
 *  collapse to the same key. `undefined` stays `undefined` (no default substitution at this pure
 *  layer — that is the handler's job). */
export function normalizeOutDir(outDir: string | undefined): string | undefined {
  if (outDir === undefined) return undefined;
  const n = posix.normalize(outDir);
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    const out: JsonObject = {};
    for (const k of Object.keys(v as JsonObject).sort()) out[k] = sortKeysDeep((v as JsonObject)[k]);
    return out;
  }
  return v;
}

/** Deterministic, key-order-independent JSON — the ONLY thing `primitiveCallKey` hashes. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeysDeep(v));
}

/** Resume/replay key for a decide()/generateImage() call — kind-prefixed so the two primitives
 *  never collide on the same label/model/inputs. For `kind:'image'`, `outDir` is normalized BEFORE
 *  hashing so equivalent outDir spellings produce the same key. */
export function primitiveCallKey(kind: PrimitiveKind, label: string, model: string, inputs: unknown): CallKey {
  let toHash = inputs;
  if (kind === 'image' && isPlainObject(inputs) && 'outDir' in inputs) {
    const raw = inputs['outDir'];
    const normalized = typeof raw === 'string' || raw === undefined ? normalizeOutDir(raw) ?? null : raw;
    toHash = { ...inputs, outDir: normalized };
  }
  const hash = createHash('sha256').update(canonicalJson(toHash)).digest('hex');
  return { prompt: `${kind}:${hash}`, opts: { label, model } };
}

/** True iff `answers` has a value for every asked question id, each shaped and in-range for its
 *  own declared type: a `choice` answer's `choice` is one of `criteria`'s keys; a `bool` answer's
 *  `probability` is finite in [0,1]; a `score` answer's `score` is finite. */
export function checkAnswers(questions: Record<string, DecideQuestion>, answers: Record<string, DecideAnswer>): boolean {
  for (const id of Object.keys(questions)) {
    const q = questions[id]!;
    const a = answers[id];
    if (a === undefined || a.type !== q.type) return false;
    if (a.type === 'bool') {
      if (!Number.isFinite(a.probability) || a.probability < 0 || a.probability > 1) return false;
    } else if (a.type === 'choice') {
      if (!Object.keys(q.criteria).includes(a.choice)) return false;
    } else if (a.type === 'score') {
      if (!Number.isFinite(a.score)) return false;
    }
  }
  return true;
}
