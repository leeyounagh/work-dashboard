package main

import (
	"context"

	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// Version is overridden at build time with -ldflags "-X main.Version=...".
var Version = "0.0.0-dev"

// workspaceLister is the part of the workspace store the UI needs.
type workspaceLister interface {
	List() workspace.ListResult
}

// App holds the methods bound to the frontend.
type App struct {
	ctx        context.Context
	workspaces workspaceLister
}

// NewApp wires the app with its dependencies.
func NewApp(workspaces workspaceLister) *App {
	return &App{workspaces: workspaces}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// Workspaces returns the saved workspaces and any files that failed to load.
func (a *App) Workspaces() workspace.ListResult {
	return a.workspaces.List()
}
