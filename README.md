# work-dashboard

A lightweight desktop work dashboard for Claude Code users.

- **Workspaces** — group the folders you work on together; terminals open `claude --add-dir` for all of them.
- **Toggleable widgets** — PR reviews (any reviewer), CI failures, review queue, Linear/Notion through your Claude connectors, deploy status, worktrees, QA runs, Claude usage limits.
- **Terminal + file tree** — embedded terminals, and files Claude opens for you appear in the tree.
- **Pixel office** — each Claude session is a pixel character on a dark-gray floor.

Inspired by [Munder Difflin](https://github.com/HarnessMD/munder-difflin), rebuilt small:
a single ~10 MB Windows executable (Wails + the system WebView2) instead of an Electron app.

> Status: all roadmap phases are in. See the roadmap below.

## Requirements

- Windows 10/11 (WebView2 runtime ships with Windows 11)
- [Claude Code](https://claude.com/claude-code) and the [GitHub CLI](https://cli.github.com/) for the data widgets

## Workspaces & terminals

A workspace is a named set of folders plus notes. **+ Claude** starts `claude` in the first
folder with `--add-dir` for the others, a fresh `--session-id`, and the notes passed through
`--append-system-prompt-file`. **+ 셸** opens PowerShell in the first folder.

## Develop

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
WD_DEV_UNLOCK=1 wails dev         # live reload (local data is locked without it, see below)
wails build -clean -ldflags "-s -w"   # build/bin/work-dashboard.exe

go test -cover ./...
cd frontend && npm test
```

> **Security note for `wails dev`:** the Wails dev server accepts websocket calls from any
> origin, so any web page open in a browser could call the bound methods. Every method that runs
> commands or returns local data is therefore disabled in dev builds unless you start with
> `WD_DEV_UNLOCK=1`; don't browse untrusted sites while doing so. Release builds are not affected.

## Widgets

Open **위젯 관리** on the right: switch built-in widgets on/off, add your own **명령 출력** (any
command's output, no shell) or **링크 모음** widgets as many times as you like, or ask Claude for
suggestions in plain words. Linear and Notion widgets go through the connectors you already set up
in Claude Code, with read-only tools only.

## Your own characters

The office uses the CC0 Ninja Adventure characters. To use other art you are allowed to use,
put sprite sheets in `~/.work-dashboard/characters/*.png` (64×112: 4 columns down/up/left/right ×
7 rows of 16×16, rows 0–3 walking, row 4 action). They stay on your computer.

## Local data

Nothing personal lives in this repository. Workspaces and settings are stored per user in
`~/.work-dashboard/` (`workspaces/<id>.json`, `notes/<id>.md`). Tokens are never written there.

## Layout

```
main.go, app.go          Wails entry point and the methods bound to the UI
internal/widget          widget catalog + setting validation
internal/workspace       workspace model + JSON store
internal/term            pseudo-terminal sessions (ConPTY via go-pty)
internal/launch          workspace → claude / shell command lines
internal/fsutil          atomic file writes
frontend/                Vite + TypeScript UI (dark-gray tokens in src/styles/tokens.css)
```

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Scaffold, dark-gray layout, widget schema |
| 1 | Embedded terminals (ConPTY + xterm.js), workspaces, `claude --add-dir` |
| 2 | File tree + viewer, `open_files` MCP tool, Claude hook receiver |
| 3 | Widget engine: PR reviews, CI failures, review queue, Claude usage & login |
| 4 | Personal workspace presets |
| 5 | Linear / Notion (via Claude connectors), deploy status, worktrees, QA |
| 6 | Pixel office: session ↔ character state |
| 7 | Claude-powered widget recommendations for new users |

## License

MIT
