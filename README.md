# work-dashboard

![work-dashboard](docs/screenshot.png)

**[한국어](#한국어) · [English](#english)**

---

## 한국어

Claude Code 사용자를 위한 가벼운 데스크톱 업무 대시보드입니다.
[Munder Difflin](https://github.com/HarnessMD/munder-difflin) 에서 영감을 받아 작게 다시 만들었습니다 —
Electron 앱 대신 OS 의 웹 엔진을 쓰는 작은 앱 하나(Windows 약 13 MB, Wails)입니다. Windows · macOS · Linux 를 지원합니다.

### 다운로드

[Releases](https://github.com/leeyounagh/work-dashboard/releases) 에서 OS 에 맞는 파일을 받으세요.

| OS | 파일 | 처음 열 때 |
|---|---|---|
| Windows 10/11 | `work-dashboard-windows-amd64.exe` | SmartScreen 경고가 뜨면 「추가 정보 → 실행」 |
| macOS (Intel · Apple 칩) | `work-dashboard-macos-universal.zip` | 압축을 풀어 「응용 프로그램」 으로 옮긴 뒤, 서명이 없어서 처음 한 번은 **오른쪽 클릭 → 열기 → 열기**. 그래도 막히면 터미널에서 `xattr -dr com.apple.quarantine /Applications/work-dashboard.app` |
| Linux (x86-64) | `work-dashboard-linux-amd64.tar.gz` | WebKitGTK 가 필요합니다: Ubuntu/Debian `sudo apt install libwebkit2gtk-4.1-0`, Fedora `sudo dnf install webkit2gtk4.1` |

macOS 에서는 단축키가 Ctrl 대신 **Cmd** 입니다 (확대 Cmd +/−/0, 터미널 복사·붙여넣기 Cmd+C/V).

### 무엇을 하나요

- **워크스페이스** — 함께 작업하는 폴더들을 묶습니다. **+ Claude** 는 첫 폴더에서 `claude` 를 열고 나머지는
  `--add-dir` 로 넘기며, 워크스페이스 메모를 `--append-system-prompt-file` 로 전달합니다. **+ 셸** 은 PowerShell 을 엽니다.
- **터미널 + 파일 트리** — 터미널이 앱 안에 있고, Claude 에게 「○○ 코드 열어줘」 라고 하면 그 파일이 트리와 뷰어에 열립니다.
  파일 이름·경로 검색도 됩니다. 앱을 다시 켜면 열려 있던 Claude 대화를 이어서 열 수 있습니다.
- **처음 켜지는 위젯** — 새 워크스페이스는 이 컴퓨터에서 바로 쓸 수 있는 위젯만 켜고 시작합니다.
  폴더가 GitHub 레포이고 `gh` 에 로그인돼 있으면 그 레포의 PR 위젯, git 레포면 워크트리, 그리고 항상 오늘 할 일·Claude 한도·세션 복원.
  Linear · Notion · 배포 · QA 처럼 계정이나 설정이 필요한 위젯은 꺼진 채로 「위젯 관리」에 있고,
  설정이 덜 된 위젯은 오류 대신 무엇을 넣으면 되는지 알려 줍니다.
- **켜고 끄는 위젯**
  - PR 리뷰 현황, CI 실패 PR, 리뷰 요청 큐 (GitHub CLI)
  - Linear 내 이슈(할 일 → 진행 중 → 리뷰·확인 중으로 묶음), Linear 알림(나를 부르거나 내가 담당인 것만), Notion 명세 —
    Claude Code 에 이미 연결한 커넥터를 읽기 전용 도구로만 씁니다. 토큰을 따로 발급하지 않아도 됩니다.
  - 배포·스왑 대기, 워크트리 상태, QA 실행, Claude 한도·로그인, 세션 복원
  - 오늘 할 일: 적고 체크, 끝낸 항목은 다음 날 정리
  - 직접 만드는 위젯 (여러 개 추가 가능): **명령 출력**(셸 없이 실행), **링크 모음**, **폴더 문서**(최근 수정 순, 누르면 기본 앱으로 열기)
  - 문서 위젯(폴더 문서·Notion 명세·QA 보고서)에는 검색창이 있습니다
  - 「Claude 에게 추천받기」 에 원하는 것을 적으면 맞는 위젯을 골라 줍니다 (Claude 는 도구 없이 추천만 합니다)
- **도트 사무실** — Claude 세션마다 캐릭터가 하나씩 있고, 훅 이벤트에 따라 책상에서 일하거나 돌아다닙니다.
  진행률과 지금 쓰는 도구가 머리 위에 보이고, 누르면 그 터미널로 갑니다.
  오른쪽 아래 **가이드** 를 누르면 워크스페이스 기술(go.mod, package.json, pubspec.yaml … 을 보고 판단)에 맞는
  기술 블로그를 엽니다. 사이드바의 「가이드 주제」 로 직접 정할 수 있고, 찾지 못하면 AI 관련 사이트를 엽니다.
- **사용량에 따라 바뀌는 사무실**
  - 5시간 한도: 50% 부터 해가 지고, 90% 를 넘으면 책상 스탠드가 켜집니다(야근 모드). 오른쪽 벽 커피포트가 줄어들다
    비면 쉬는 캐릭터들이 「커피…」 하며 줄을 서고, 한도가 초기화되면 아침 햇살이 듭니다.
  - 7일 한도: 60% 부터 화분이 시들고, 85% 를 넘으면 갈색이 되어 잎이 떨어집니다.
  - 세션 토큰: 1만 토큰마다 책상에 서류가 쌓이고(최대 8장), 10만부터 커피잔이 늘고 땀을 흘립니다.
    10만 · 50만 · 100만에서 폭죽과 🏆 가 터지고, 왼쪽 벽 「오늘의 MVP」 액자에 가장 많이 쓴 터미널이 걸립니다.
  - 이번 주 누적: 50만이면 책장, 300만이면 소파, 1,000만이면 수족관이 생깁니다.
  - 토큰은 입력 + 캐시 쓰기 + 출력이고 캐시 읽기는 뺍니다(매 턴 대화 전체를 다시 읽는 양이라 너무 커서).
    이어서 연 세션은 대시보드가 연 뒤부터 셉니다.
- **화면 확대** — Ctrl + / Ctrl − / Ctrl 0 (배율은 기억됩니다), 패널 폭은 드래그로 조절합니다.

### 구동 원리

브라우저 화면을 품은 데스크톱 프로그램 하나입니다. 화면은 웹 기술(TypeScript)로 그리고, 실제 일은 같은 exe 안의 Go 코드가 합니다.

```
┌─────────────── work-dashboard ─────────────────┐
│ 화면: OS 웹 엔진(WebView2·WebKit) + TS         │
│   ↕ 함수 호출 · 이벤트 (Wails)                 │
│ Go: 터미널(pty) · 파일 · gh/git/claude 실행    │
│     · 127.0.0.1 브리지(Claude 훅 · open_files) │
└────────────────────────────────────────────────┘
   설정 → ~/.work-dashboard/      외부 → gh · claude
```

- **터미널** — Go 가 Windows 가상 콘솔(ConPTY)로 `claude --add-dir … --session-id …` 를 실행하고, 출력은 xterm.js 화면으로 보냅니다.
- **사무실** — Claude 를 띄울 때 훅을 이 PC 의 작은 서버(127.0.0.1, 세션별 토큰)로 보내도록 설정해 두고,
  도구 사용 · 대기 · 완료 신호에 맞춰 캐릭터를 움직입니다. 「코드 열어줘」 는 같은 서버의 `open_files` MCP 도구로 파일 트리에 열립니다.
  토큰 수는 훅이 알려 주는 세션 대화 기록(`~/.claude/projects/…/<session>.jsonl`)을 이어 읽어 셉니다.
  한도 사용률은 「Claude 한도」 위젯과 같은 값을 2분마다 받아 씁니다.
- **위젯** — 화면이 3분마다 Go 에 데이터를 요청하면, Go 가 `gh`(PR) · `git`(워크트리) · 파일(문서) ·
  `claude -p`(리니어 · 노션, 기본 도구 없이 읽기 전용 커넥터 도구만)로 가져옵니다.
- **저장 · 통신** — 설정은 각자 PC 의 JSON 파일이고 서버 · 계정 · 토큰 저장이 없습니다. 바깥 통신은 사용자가 로그인해 둔 `gh` 와 `claude` 를 빌려 쓰는 것뿐입니다.

### 필요한 것

- Windows 10/11 (WebView2 런타임은 Windows 11 에 기본 포함), macOS 11 이상, 또는 WebKitGTK 4.1 이 있는 Linux
- 데이터 위젯용 [Claude Code](https://claude.com/claude-code) 와 [GitHub CLI](https://cli.github.com/)

### 내 데이터

이 레포에는 개인 정보가 없습니다. 워크스페이스와 설정은 사용자별로 `~/.work-dashboard/` 에 저장됩니다
(`workspaces/<id>.json`, `notes/<id>.md`, 사무실용 날짜별 토큰 사용량 `tokens.json` — 최근 14일).
로그인 토큰 · API 키는 저장하지 않습니다.
`WD_DATA_DIR=<절대 경로>` 로 다른 데이터 폴더를 쓸 수 있습니다 (데모·스크린샷용).

### 내 캐릭터 쓰기

사무실은 CC0 Ninja Adventure 캐릭터를 씁니다. 쓸 권리가 있는 다른 그림을 쓰려면
`~/.work-dashboard/characters/*.png` 에 스프라이트 시트를 넣으세요 (아래/위/왼쪽/오른쪽 4열 × 7행의 정사각 프레임,
0–3행 걷기, 4행 책상 작업 동작, 5–6행 쉴 때 랜덤으로 나오는 포즈 8개 — 16×16 이면 64×112, 프레임 크기는 자유, 파일당 512 KB 이하).
파일은 내 컴퓨터에만 있고, 넣으면 Claude 캐릭터가 그중에서 랜덤으로 나옵니다. `guide.png` 는 사무실 가이드가 됩니다.

### 개발

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
WD_DEV_UNLOCK=1 wails dev               # 라이브 리로드 (없으면 로컬 데이터가 잠깁니다, 아래 참고)
wails build -ldflags "-s -w"           # build/bin/work-dashboard.exe (macOS: -platform darwin/universal, Linux: -tags webkit2_41)

go test -cover ./...
cd frontend && npm test
```

> **`wails dev` 보안 주의:** Wails 개발 서버는 어느 출처의 웹소켓 호출이든 받기 때문에, 브라우저에 열린 아무 웹 페이지나
> 바인딩된 메서드를 부를 수 있습니다. 그래서 개발 빌드에서는 명령을 실행하거나 로컬 데이터를 돌려주는 메서드가 모두 막혀 있고,
> `WD_DEV_UNLOCK=1` 일 때만 풀립니다. 그동안은 믿을 수 없는 사이트를 열지 마세요. 배포 빌드는 해당 없습니다.

---

## English

A lightweight desktop work dashboard for Claude Code users.
Inspired by [Munder Difflin](https://github.com/HarnessMD/munder-difflin), rebuilt small:
one small app using the operating system's web engine (~13 MB on Windows, Wails) instead of an Electron app. It runs on
Windows, macOS and Linux.

### Download

Get the file for your OS from [Releases](https://github.com/leeyounagh/work-dashboard/releases).

| OS | File | First start |
|---|---|---|
| Windows 10/11 | `work-dashboard-windows-amd64.exe` | if SmartScreen warns, "More info → Run anyway" |
| macOS (Intel and Apple silicon) | `work-dashboard-macos-universal.zip` | unzip, move it to Applications; it is not signed, so the first time **right-click → Open → Open**. Still blocked: `xattr -dr com.apple.quarantine /Applications/work-dashboard.app` |
| Linux (x86-64) | `work-dashboard-linux-amd64.tar.gz` | needs WebKitGTK: Ubuntu/Debian `sudo apt install libwebkit2gtk-4.1-0`, Fedora `sudo dnf install webkit2gtk4.1` |

On macOS the shortcuts use **Cmd** instead of Ctrl (zoom Cmd +/−/0, terminal copy/paste Cmd+C/V).

### What it does

- **Workspaces** — group the folders you work on together. **+ Claude** starts `claude` in the first folder with
  `--add-dir` for the others and the workspace notes via `--append-system-prompt-file`; **+ 셸** opens PowerShell.
- **Terminals + file tree** — embedded terminals; files Claude opens for you ("open the X code") appear in the tree and
  viewer. File name/path search, and Claude conversations that were open can be resumed after a restart.
- **What starts switched on** — a new workspace turns on only the widgets that work on this computer: PR widgets
  for the folder's GitHub repositories when `gh` is logged in, worktrees for git folders, and always to-dos, Claude usage and
  session restore. Linear, Notion, deploy status and QA need an account or settings, so they wait in widget management;
  a widget that isn't set up yet says what to fill in instead of showing an error.
- **Toggleable widgets**
  - PR reviews, CI failures, review queue (GitHub CLI)
  - My Linear issues (grouped: to do → in progress → in review/test), Linear inbox (only mentions, assignments and my
    own issues), Notion specs — through the connectors you already set up in Claude Code, with read-only tools only.
    No extra API tokens.
  - Deploy/swap status, worktrees, QA runs, Claude usage limits & login, session restore
  - Today's to-dos: write, tick, finished items are cleared the next day
  - Your own widgets, as many as you like: **command output** (no shell), **links**, **folder documents** (newest first,
    opens with the default app)
  - Document widgets (folder documents, Notion specs, QA reports) have a search box
  - Describe what you want and Claude suggests widgets (Claude gets no tools, it only suggests)
- **Pixel office** — each Claude session is a character that works at a desk or wanders, driven by Claude hooks, with
  progress and the current tool above its head; click it to jump to its terminal. Click the **guide** (bottom right)
  for a tech blog matching the workspace (detected from go.mod, package.json, pubspec.yaml, …, or set by the workspace's
  guide topics), or an AI site when nothing matches.
- **An office that follows your usage**
  - 5-hour limit: dusk from 50%, desk lamps from 90% (working late). The coffee pot on the right wall drains, and when
    it is empty idle characters queue at it ("커피…"); a limit reset brings the morning sun.
  - 7-day limit: the plants wilt from 60% and turn brown, dropping leaves, from 85%.
  - Session tokens: paper piles up on the desk every 10K tokens (up to 8 sheets); from 100K coffee cups appear and the
    character sweats. 100K, 500K and 1M set off confetti and a 🏆, and the "오늘의 MVP" frame on the left wall shows
    the terminal that used the most.
  - This week's total: a bookshelf at 500K, a sofa at 3M, an aquarium at 10M.
  - Tokens are input + cache writes + output; cache reads are left out (every turn re-reads the whole conversation,
    which would dwarf the rest). A resumed session counts from when the dashboard opened it.
- **Zoom** — Ctrl + / Ctrl − / Ctrl 0 (remembered); drag the panel edges to resize.

### How it works

One desktop program with a browser view inside: the UI is web tech (TypeScript), the real work is done by Go code in
the same executable.

```
┌─────────────── work-dashboard ─────────────────┐
│ UI: OS web engine (WebView2 / WebKit) + TS     │
│   ↕ calls · events (Wails)                     │
│ Go: pty terminals · files · gh/git/claude      │
│     · 127.0.0.1 bridge (hooks, open_files)     │
└────────────────────────────────────────────────┘
   settings → ~/.work-dashboard/   outside → gh · claude
```

- **Terminals** — Go runs `claude --add-dir … --session-id …` in a Windows pseudo console (ConPTY) and streams it to xterm.js.
- **Office** — Claude is started with hooks that post to a small local server (127.0.0.1, per-session tokens); tool
  use, waiting and done move the characters. "Open that code" goes through the same server's `open_files` MCP tool.
  Token counts come from reading on through the session transcript the hooks point to
  (`~/.claude/projects/…/<session>.jsonl`); the limit percentages are the Claude usage widget's, fetched every 2 minutes.
- **Widgets** — every 3 minutes the UI asks Go, which reads `gh` (PRs), `git` (worktrees), files (documents) or
  `claude -p` (Linear, Notion — no built-in tools, read-only connector tools only).
- **Storage & network** — settings are JSON files on your own PC; no server, account or stored tokens. The only outside
  traffic is the `gh` and `claude` you are already logged into.

### Requirements

- Windows 10/11 (the WebView2 runtime ships with Windows 11), macOS 11+, or Linux with WebKitGTK 4.1
- [Claude Code](https://claude.com/claude-code) and the [GitHub CLI](https://cli.github.com/) for the data widgets

### Local data

Nothing personal lives in this repository. Workspaces and settings are stored per user in `~/.work-dashboard/`
(`workspaces/<id>.json`, `notes/<id>.md`, and `tokens.json` — daily token usage for the office, last 14 days).
Login tokens and API keys are never written there.
Set `WD_DATA_DIR=<absolute path>` to use another data folder (demos, screenshots).

### Your own characters

The office uses the CC0 Ninja Adventure characters. To use other art you are allowed to use, put sprite sheets in
`~/.work-dashboard/characters/*.png` (4 columns down/up/left/right × 7 rows of square frames, rows 0–3 walking,
row 4 working at a desk, rows 5–6 up to 8 idle poses shown at random — 64×112 for 16×16 frames, any frame size works, up to 512 KB each). They stay on your
computer; each Claude session gets one of them, and `guide.png` becomes the office guide.

### Develop

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
WD_DEV_UNLOCK=1 wails dev               # live reload (local data is locked without it, see below)
wails build -ldflags "-s -w"           # build/bin/work-dashboard.exe (macOS: -platform darwin/universal, Linux: -tags webkit2_41)

go test -cover ./...
cd frontend && npm test
```

> **Security note for `wails dev`:** the Wails dev server accepts websocket calls from any origin, so any web page open
> in a browser could call the bound methods. Every method that runs commands or returns local data is therefore
> disabled in dev builds unless you start with `WD_DEV_UNLOCK=1`; don't browse untrusted sites while doing so.
> Release builds are not affected.

### Layout

```
main.go, app.go           Wails entry point and the methods bound to the UI
terminals.go, agents.go   terminals, Claude sessions, hook events
officetokens.go           session token counts for the office
widgets.go, localwidgets.go, folderwidget.go, linearfilter.go, recommend.go, guide.go
                          widget data, recommendations, office guide
internal/widget           widget catalog + setting validation
internal/workspace        workspace model + JSON store
internal/term             pseudo-terminal sessions (ConPTY via go-pty)
internal/launch           workspace → claude / shell command lines
internal/bridge           localhost bridge for Claude hooks and the open_files MCP tool
internal/claudeask        headless `claude -p` lookups through connectors
internal/command          no-shell command runner for the command widget
internal/files            file tree, viewer, search (kept inside the workspace)
internal/tokens           transcript token reader + daily totals (tokens.json)
frontend/                 Vite + TypeScript UI (dark-gray tokens in src/styles/tokens.css)
```

## License

MIT · Characters: [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack) (CC0), see
`frontend/src/assets/characters/LICENSE.md`.
