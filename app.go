package main

import (
	"context"
	"encoding/base64"
	"sync"
	"sync/atomic"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/claudeask"
	"github.com/leeyounagh/work-dashboard/internal/github"
	"github.com/leeyounagh/work-dashboard/internal/sessions"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// Version is overridden at build time with -ldflags "-X main.Version=...".
var Version = "0.0.0-dev"

// Event names emitted to the frontend.
const (
	eventTermData = "term:data"
	eventTermExit = "term:exit"
)

// workspaceStore is the part of the workspace store the UI needs.
type workspaceStore interface {
	List() workspace.ListResult
	Get(id string) (workspace.Workspace, error)
	Create(ws workspace.Workspace) error
	Save(ws workspace.Workspace) error
	Delete(id string) error
}

// Deps are the App's collaborators, injected so tests can replace them.
type Deps struct {
	Workspaces workspaceStore
	Start      term.Starter
	// Emit sends an event to the frontend (runtime.EventsEmit in production).
	Emit func(ctx context.Context, name string, data any)
	// FindClaude resolves the claude executable.
	FindClaude func() (string, error)
	// Shell is the interactive shell executable for plain terminals.
	Shell string
	// NotesDir holds workspace notes passed to claude.
	NotesDir string
	// NewSessionID returns a UUID for a new Claude session.
	NewSessionID func() string
	// PickFolder shows a native folder picker ("" when cancelled).
	PickFolder func(ctx context.Context) (string, error)
	// DevLocked disables every binding that runs commands or returns local
	// data. `wails dev` exposes bound methods to any web page over its
	// websocket, so dev builds lock them unless WD_DEV_UNLOCK=1 is set.
	DevLocked bool
	// Bridge connects Claude sessions back to the dashboard (nil disables it).
	Bridge claudeBridge
	// RunDir holds per-session bridge config files.
	RunDir string
	// GitHub runs the gh CLI.
	GitHub github.Runner
	// Claude reads the local Claude Code login and usage.
	Claude claudeAccount
	// Now is the clock (nil = time.Now).
	Now func() time.Time
	// Ask runs headless claude for connector lookups (Linear, Notion).
	Ask claudeask.Runner
	// Sessions remembers Claude sessions for resuming.
	Sessions sessionStore
	// CharactersDir holds the user's own character sprite sheets.
	CharactersDir string
	// Restorable are sessions that were open when the app last exited.
	Restorable []sessions.Record
}

// App holds the methods bound to the frontend.
type App struct {
	ctx    context.Context
	deps   Deps
	terms  *term.Manager
	agents *agentRegistry
	prs    prCache
	asks   askCache
	// shuttingDown keeps sessions killed by app exit marked open, so they
	// can be offered for restore next time.
	shuttingDown atomic.Bool
	restoreMu    sync.Mutex
	// life is cancelled on shutdown so widget loads (gh, git, headless claude)
	// stop with the app.
	life      context.Context
	stopLoads context.CancelFunc
}

// NewApp wires the app with its dependencies.
func NewApp(deps Deps) *App {
	a := &App{ctx: context.Background(), deps: deps, agents: newAgentRegistry()}
	a.life, a.stopLoads = context.WithCancel(context.Background())
	a.terms = term.NewManager(deps.Start, a.emitData, a.emitExit)
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(context.Context) {
	a.shuttingDown.Store(true)
	a.stopLoads()
	a.terms.CloseAll()
}

// TermData is one chunk of terminal output. Data is base64 so that a chunk
// ending mid UTF-8 sequence survives JSON encoding.
type TermData struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}

// TermExit reports that a terminal's process ended.
type TermExit struct {
	ID    string `json:"id"`
	Error string `json:"error,omitempty"`
}

func (a *App) emitData(id string, b []byte) {
	a.deps.Emit(a.ctx, eventTermData, TermData{ID: id, Data: base64.StdEncoding.EncodeToString(b)})
}

func (a *App) emitExit(id string, err error) {
	a.endAgentSession(id)
	ev := TermExit{ID: id}
	if err != nil {
		ev.Error = err.Error()
	}
	a.deps.Emit(a.ctx, eventTermExit, ev)
}

// AppInfo is basic build information shown in the UI.
type AppInfo struct {
	Version string `json:"version"`
}

// Info returns build information.
func (a *App) Info() AppInfo {
	return AppInfo{Version: Version}
}

// WidgetCatalog returns every widget type the dashboard can show.
func (a *App) WidgetCatalog() []widget.Definition {
	return widget.Catalog()
}
