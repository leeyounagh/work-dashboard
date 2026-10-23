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
import type { TabHost } from '../tabs/tabHost';
import { baseName, languageFor, type Language } from './fileState';

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
  { tag: t.link, color: '#7aa2f7', textDecoration: 'underline' },
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

interface Viewer {
  view: EditorView;
  mode: 'file' | 'diff';
}

const fileTabId = (path: string) => `file:${path.toLowerCase()}`;

export class FileViewer {
  private readonly viewers = new Map<string, Viewer>();

  constructor(
    private readonly tabs: TabHost,
    private readonly onError: (message: string) => void,
  ) {}

  /** Opens (or focuses) a file tab. */
  async open(path: string, focus = true): Promise<void> {
    const id = fileTabId(path);
    if (this.tabs.has(id)) {
      if (focus) this.tabs.activate(id);
      return;
    }
    let content;
    try {
      content = await ReadFile(path);
    } catch (err) {
      this.onError(String(err));
      return;
    }
    if (this.tabs.has(id)) return; // opened meanwhile

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
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'ghost';
    reloadBtn.textContent = '새로고침';
    bar.append(where, diffBtn, reloadBtn);
    const host = document.createElement('div');
    host.className = 'file-editor';
    pane.append(bar, host);

    const note = content.binary
      ? '(바이너리 파일은 표시하지 않습니다)'
      : content.truncated
        ? `\n… (${Math.round(content.size / 1024)}KB 중 앞부분만 표시)`
        : '';
    const viewer: Viewer = {
      view: editor(host, content.binary ? note : content.text + note, content.binary ? 'text' : languageFor(path)),
      mode: 'file',
    };
    this.viewers.set(id, viewer);

    const show = async (mode: 'file' | 'diff') => {
      try {
        const text = mode === 'diff' ? (await FileDiff(path)) || '(커밋 이후 변경 없음)' : (await ReadFile(path)).text;
        viewer.view.destroy();
        viewer.view = editor(host, text, mode === 'diff' ? 'diff' : languageFor(path));
        viewer.mode = mode;
        diffBtn.textContent = mode === 'diff' ? '파일 보기' : '변경 보기';
      } catch (err) {
        this.onError(String(err));
      }
    };
    diffBtn.addEventListener('click', () => void show(viewer.mode === 'diff' ? 'file' : 'diff'));
    reloadBtn.addEventListener('click', () => void show(viewer.mode));

    const previous = this.tabs.activeId;
    this.tabs.add({
      id,
      title: baseName(path),
      tooltip: path,
      kind: 'file',
      pane,
      onClose: () => this.close(id),
    });
    // Background opens (several files at once) keep the current tab in front.
    if (!focus && previous) this.tabs.activate(previous);
  }

  private close(id: string) {
    this.viewers.get(id)?.view.destroy();
    this.viewers.delete(id);
    this.tabs.remove(id);
  }
}
