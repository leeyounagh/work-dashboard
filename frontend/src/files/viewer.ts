import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, foldGutter, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { java } from '@codemirror/lang-java';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { diff } from '@codemirror/legacy-modes/mode/diff';

import { FileDiff, ReadFile } from '../../wailsjs/go/main/App';
import type { files } from '../../wailsjs/go/models';
import type { TabHost } from '../tabs/tabHost';
import { baseName, languageFor, pathKey, type Language } from './fileState';

const LANGUAGES: Record<Language, () => Extension> = {
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  json: () => json(),
  markdown: () => markdown(),
  css: () => css(),
  html: () => html(),
  python: () => python(),
  go: () => go(),
  yaml: () => yaml(),
  sql: () => sql(),
  java: () => java(),
  shell: () => StreamLanguage.define(shell),
  diff: () => StreamLanguage.define(diff),
  text: () => [],
};

// Dark-gray theme matching tokens.css.
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#1e1f22', color: '#e3e5e8', fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'Cascadia Mono', Consolas, monospace", lineHeight: '1.5' },
    '.cm-gutters': { backgroundColor: '#1e1f22', color: '#5c6370', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#2b2d31' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#3a3c42 !important' },
    '.cm-cursor': { borderLeftColor: '#e3e5e8' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#c678dd' },
  { tag: [t.string, t.special(t.string), t.inserted], color: '#98c379' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d19a66' },
  { tag: [t.comment, t.meta], color: '#7f848e', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
  { tag: [t.typeName, t.className, t.namespace], color: '#e5c07b' },
  { tag: [t.propertyName, t.attributeName], color: '#e06c75' },
  { tag: [t.heading, t.strong], color: '#e5c07b', fontWeight: 'bold' },
  { tag: [t.deleted, t.invalid], color: '#f2777a' },
  { tag: t.link, color: '#d4a27f', textDecoration: 'underline' },
]);

function editor(parent: HTMLElement, text: string, lang: Language): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        theme,
        syntaxHighlighting(highlight),
        LANGUAGES[lang](),
      ],
    }),
  });
}

/** Text to show for a file, with a note for binary or truncated files. */
function contentToText(c: files.Content): { text: string; lang: Language } {
  if (c.binary) return { text: '(바이너리 파일은 표시하지 않습니다)', lang: 'text' };
  const note = c.truncated ? `\n… (${Math.round(c.size / 1024)}KB 중 앞부분만 표시)` : '';
  return { text: c.text + note, lang: languageFor(c.path) };
}

interface Viewer {
  view: EditorView;
  mode: 'file' | 'diff';
  request: number; // bumps on every reload so stale responses are dropped
}

const fileTabId = (path: string) => `file:${pathKey(path)}`;

export class FileViewer {
  private readonly viewers = new Map<string, Viewer>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly tabs: TabHost,
    private readonly onError: (message: string) => void,
  ) {}

  /** Opens (or focuses) a file tab. With focus=false the current tab stays in front. */
  async open(path: string, focus = true, group?: string): Promise<void> {
    const id = fileTabId(path);
    const inFlight = this.pending.get(id);
    if (inFlight) {
      await inFlight;
      if (focus) this.tabs.activate(id);
      return;
    }
    if (this.tabs.has(id)) {
      if (focus) this.tabs.activate(id);
      return;
    }
    const p = this.load(id, path, focus, group).finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    await p;
  }

  private async load(id: string, path: string, focus: boolean, group?: string): Promise<void> {
    let content;
    try {
      content = await ReadFile(path);
    } catch (err) {
      this.onError(String(err));
      return;
    }

    const pane = document.createElement('div');
    pane.className = 'file-pane';
    const bar = document.createElement('div');
    bar.className = 'file-bar';
    const where = document.createElement('span');
    where.className = 'file-path';
    where.textContent = path;
    where.title = path;
    const diffBtn = document.createElement('button');
    diffBtn.type = 'button';
    diffBtn.className = 'ghost';
    diffBtn.textContent = '변경 보기';
    diffBtn.disabled = content.binary;
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'ghost';
    reloadBtn.textContent = '새로고침';
    bar.append(where, diffBtn, reloadBtn);
    const host = document.createElement('div');
    host.className = 'file-editor';
    pane.append(bar, host);

    const first = contentToText(content);
    const viewer: Viewer = { view: editor(host, first.text, first.lang), mode: 'file', request: 0 };
    this.viewers.set(id, viewer);

    const show = async (mode: 'file' | 'diff') => {
      const request = ++viewer.request;
      try {
        let next: { text: string; lang: Language };
        if (mode === 'diff') next = { text: (await FileDiff(path)) || '(커밋 이후 변경 없음)', lang: 'diff' };
        else next = contentToText(await ReadFile(path));
        // The tab was closed or a newer reload started while we waited.
        if (this.viewers.get(id) !== viewer || request !== viewer.request) return;
        const fresh = editor(host, next.text, next.lang);
        viewer.view.destroy();
        viewer.view = fresh;
        viewer.mode = mode;
        diffBtn.textContent = mode === 'diff' ? '파일 보기' : '변경 보기';
      } catch (err) {
        this.onError(String(err));
      }
    };
    diffBtn.addEventListener('click', () => void show(viewer.mode === 'diff' ? 'file' : 'diff'));
    reloadBtn.addEventListener('click', () => void show(viewer.mode));

    this.tabs.add(
      {
        id,
        title: baseName(path),
        tooltip: path,
        kind: 'file',
        group,
        pane,
        onActivate: () => viewer.view.focus(),
        onClose: () => this.close(id),
      },
      { activate: focus },
    );
  }

  private close(id: string) {
    this.viewers.get(id)?.view.destroy();
    this.viewers.delete(id);
    this.tabs.remove(id);
  }

  /** Destroys every editor (used by Vite HMR). */
  dispose(): void {
    for (const v of this.viewers.values()) v.view.destroy();
    this.viewers.clear();
  }
}
