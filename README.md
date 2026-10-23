# work-dashboard

A lightweight desktop work dashboard for Claude Code users.

- **Workspaces** — group the folders you work on together; terminals open `claude --add-dir` for all of them.
- **Toggleable widgets** — PR reviews (any reviewer), CI failures, review queue, Linear/Notion through your Claude connectors, deploy status, worktrees, QA runs, Claude usage limits.
- **Terminal + file tree** — embedded terminals, and files Claude opens for you appear in the tree.
- **Pixel office** — each Claude session is a pixel character on a dark-gray floor.

Inspired by [Munder Difflin](https://github.com/HarnessMD/munder-difflin), rebuilt small:
a single ~10 MB Windows executable (Wails + the system WebView2) instead of an Electron app.

> Status: phase 0 (scaffold). See the roadmap below.

## Requirements

- Windows 10/11 (WebView2 runtime ships with Windows 11)
- [Claude Code](https://claude.com/claude-code) and the [GitHub CLI](https://cli.github.com/) for the data widgets

## Develop

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
wails dev                         # live reload
wails build -clean -ldflags "-s -w"   # build/bin/work-dashboard.exe

go test -cover ./...
cd frontend && npm test
```

## Local data

Nothing personal lives in this repository. Workspaces and settings are stored per user in
`~/.work-dashboard/` (e.g. `~/.work-dashboard/workspaces/<id>.json`). Tokens are never written there.

## Layout

```
main.go, app.go          Wails entry point and the methods bound to the UI
internal/widget          widget catalog + setting validation
internal/workspace       workspace model + JSON store
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
