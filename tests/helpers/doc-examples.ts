// v35 (DES-239(e), ARCH-151, TASK-237, REQ-209): the doc-example extraction rule, stated once here
// so the verifier does not invent it twice (IT-118's extension and VAL-236 both import this).
//
// Rule (DES-239(e), verbatim): strip a leading `> ` blockquote prefix from every line; a SCRIPT
// block is the body of a ```js`/```javascript``` fence or of a `<<'JS' … JS` heredoc; a MERMAID
// block is the body of a fence or `<<'MMD' … MMD` heredoc whose first non-blank line matches
// `/^(graph|flowchart)\s+LR\b/`; pair each script block with the NEXT mermaid block after it in
// document order.
//
// This is test scaffolding (helpers/ is tsc-checked, not vitest-collected) — nothing here is
// reachable from src/.
export interface DocPair {
  script: string;
  mermaid: string;
}

interface Block {
  kind: 'script' | 'mermaid';
  pos: number;
  body: string;
}

const MERMAID_HEADER_RE = /^(graph|flowchart)\s+LR\b/;

function stripBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('> ') ? line.slice(2) : line === '>' ? '' : line))
    .join('\n');
}

function firstNonBlankLine(body: string): string {
  return body.split('\n').find((l) => l.trim() !== '') ?? '';
}

/** Extracts every script+mermaid PAIR from a markdown document per DES-239(e). */
export function extractDocPairs(rawMarkdown: string): DocPair[] {
  const text = stripBlockquote(rawMarkdown);
  const lines = text.split('\n');
  const blocks: Block[] = [];

  let i = 0;
  let pos = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fenceMatch = /^```(\w*)\s*$/.exec(line.trim());
    const jsHeredocMatch = /<<'JS'\s*$/.exec(line);
    const mmdHeredocMatch = /<<'MMD'\s*$/.exec(line);

    if (fenceMatch) {
      const lang = fenceMatch[1] ?? '';
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j]!.trim() !== '```'; j++) bodyLines.push(lines[j]!);
      const body = bodyLines.join('\n');
      // A `return` statement distinguishes a COMPLETE, standalone runnable script from an inline
      // illustrative fragment (a bare meta declaration, a two-line `allowedTools` snippet, a
      // try/catch showing refusal handling) that prose sections use to teach ONE concept — neither
      // is "a reader will copy this as a whole workflow", and prose fragments have no diagram of
      // their own to pair with (measured against docs/AUTHORING.md: every genuine worked example
      // ends with `return`; none of the fragments do).
      const isScript = (lang === 'js' || lang === 'javascript') && /\breturn\b/.test(body);
      const isMermaid = lang === '' && MERMAID_HEADER_RE.test(firstNonBlankLine(body));
      if (isScript || isMermaid) {
        blocks.push({ kind: isScript ? 'script' : 'mermaid', pos, body });
        i = j + 1;
        pos += 1;
        continue;
      }
      // An unrecognized fence (e.g. ```bash wrapping shell + heredocs, as README.md does) is NOT
      // consumed as an opaque block — its own marker line is skipped as inert, but its INTERIOR
      // keeps being scanned line-by-line so a nested `<<'JS'`/`<<'MMD'` heredoc inside it is still
      // found. Only the fence marker line itself advances here.
      i++;
      pos += 1;
      continue;
    }
    if (jsHeredocMatch) {
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j]!.trim() !== 'JS'; j++) bodyLines.push(lines[j]!);
      blocks.push({ kind: 'script', pos, body: bodyLines.join('\n') });
      i = j + 1;
      pos += 1;
      continue;
    }
    if (mmdHeredocMatch) {
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j]!.trim() !== 'MMD'; j++) bodyLines.push(lines[j]!);
      const body = bodyLines.join('\n');
      if (MERMAID_HEADER_RE.test(firstNonBlankLine(body))) blocks.push({ kind: 'mermaid', pos, body });
      i = j + 1;
      pos += 1;
      continue;
    }
    i++;
    pos += 1;
  }

  // "The NEXT mermaid block after it" means the immediately-following recognized block (only a
  // caption/prose may sit between them, never another script block) — a prose-illustrative code
  // fragment (no diagram of its own) is followed by the NEXT WORKED EXAMPLE's own script, not by
  // a diagram, and is correctly excluded rather than mis-paired with a diagram many paragraphs
  // away that belongs to a different example.
  const pairs: DocPair[] = [];
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k]!.kind !== 'script') continue;
    const next = blocks[k + 1];
    if (next && next.kind === 'mermaid') pairs.push({ script: blocks[k]!.body, mermaid: next.body });
  }
  return pairs;
}
