/**
 * Ctrl+click "go to definition" in the file viewer: what was clicked, read
 * from the file's text. The Go side resolves it (FindDefinition).
 */

/** What to look up: name imported from spec, or declared in this file when spec is "". */
export interface GotoTarget {
  spec: string;
  name: string; // "" for the module itself, "default", "*" for a namespace
}

const IDENT = /[A-Za-z0-9_$]/;

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare default delete do else enum export ' +
    'extends false finally for from function get if implements import in instanceof interface keyof let new null of ' +
    'private protected public readonly return satisfies set static super switch this throw true try type typeof undefined ' +
    'var void while with yield'
  ).split(' '),
);

/** Languages whose imports the viewer can follow. */
export const NAVIGABLE = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

// import X, { A as B, type C } from "x"  /  import * as ns from "x"  /  import type { T } from "x"
const IMPORT = /\bimport\s+(?:type\s+)?([^'";]*?)\s+from\s*(['"])([^'"]+)\2/g;
// export { A as B } from "x"
const RE_EXPORT = /\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;
// The statements a module path in quotes belongs to.
const MODULE_STRING = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)$/;

/** Local name → where it was imported from, for every import in the text. */
export function importsIn(text: string): Map<string, GotoTarget> {
  const out = new Map<string, GotoTarget>();
  for (const m of text.matchAll(IMPORT)) {
    let clause = m[1].trim();
    const spec = m[3];
    const brace = clause.indexOf('{');
    if (brace >= 0) {
      const end = clause.indexOf('}', brace);
      for (const item of clause.slice(brace + 1, end < 0 ? undefined : end).split(',')) {
        const [orig, local] = asPair(item);
        if (local) out.set(local, { spec, name: orig });
      }
      clause = clause.slice(0, brace).replace(/,\s*$/, '');
    }
    for (const part of clause.split(',').map((p) => p.trim())) {
      const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      if (ns) out.set(ns[1], { spec, name: '*' });
      else if (/^[A-Za-z_$][\w$]*$/.test(part)) out.set(part, { spec, name: 'default' });
    }
  }
  return out;
}

/** "A", "A as B", "type A as B" → [original, local]. */
function asPair(item: string): [string, string] {
  const s = item.trim().replace(/^type\s+/, '');
  const m = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
  return m ? [m[1], m[2]] : [s, s];
}

/** The quoted module path around pos, if pos is inside one. */
function moduleStringAt(text: string, pos: number): string | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = text.indexOf('\n', pos) < 0 ? text.length : text.indexOf('\n', pos);
  const line = text.slice(lineStart, lineEnd);
  const at = pos - lineStart;
  for (const m of line.matchAll(/(['"])([^'"\n]*)\1/g)) {
    const start = m.index ?? 0;
    if (at > start && at < start + m[0].length && MODULE_STRING.test(line.slice(0, start))) return m[2];
  }
  return null;
}

/** The identifier at pos and where it starts, or null. */
function wordAt(text: string, pos: number): { word: string; start: number } | null {
  let start = pos;
  let end = pos;
  while (start > 0 && IDENT.test(text[start - 1])) start--;
  while (end < text.length && IDENT.test(text[end])) end++;
  const word = text.slice(start, end);
  return /^[A-Za-z_$][\w$]*$/.test(word) ? { word, start } : null;
}

/** What a Ctrl+click at pos asks for, or null when there is nothing to follow. */
export function gotoTarget(text: string, pos: number): GotoTarget | null {
  const spec = moduleStringAt(text, pos);
  if (spec) return { spec, name: '' };
  const w = wordAt(text, pos);
  if (!w || KEYWORDS.has(w.word)) return null;
  // A name inside "export { A as B } from 'x'" follows A into x.
  for (const m of text.matchAll(RE_EXPORT)) {
    const start = m.index ?? 0;
    if (w.start < start || w.start >= start + m[0].length) continue;
    for (const item of m[1].split(',')) {
      const [orig, local] = asPair(item);
      if (orig === w.word || local === w.word) return { spec: m[3], name: orig };
    }
  }
  // obj.prop is not the imported obj.
  if (text[w.start - 1] === '.' && text[w.start - 2] !== '.') return null;
  return importsIn(text).get(w.word) ?? { spec: '', name: w.word };
}
