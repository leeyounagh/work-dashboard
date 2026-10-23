package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/launch"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// Workspaces returns the saved workspaces and any files that failed to load.
func (a *App) Workspaces() workspace.ListResult {
	if err := a.unlocked(); err != nil {
		return workspace.ListResult{Workspaces: []workspace.Workspace{}, Problems: []string{err.Error()}}
	}
	return a.deps.Workspaces.List()
}

// SaveWorkspace creates (empty ID) or updates a workspace and returns it.
func (a *App) SaveWorkspace(ws workspace.Workspace) (workspace.Workspace, error) {
	if err := a.unlocked(); err != nil {
		return workspace.Workspace{}, err
	}
	ws.Name = strings.TrimSpace(ws.Name)
	folders := make([]string, len(ws.Folders))
	for i, f := range ws.Folders {
		// Clean drops trailing separators, which could otherwise escape a
		// closing quote when the path is passed on a command line.
		folders[i] = filepath.Clean(f)
	}
	ws.Folders = folders
	if ws.Widgets == nil {
		ws.Widgets = []widget.Instance{}
	}
	if ws.ID != "" {
		if err := a.deps.Workspaces.Save(ws); err != nil {
			return workspace.Workspace{}, fmt.Errorf("워크스페이스를 저장하지 못했습니다: %w", err)
		}
		return ws, nil
	}
	// A new workspace starts with every widget; an existing one may
	// legitimately have none because the user switched them all off.
	if len(ws.Widgets) == 0 {
		ws.Widgets = defaultWidgets()
	}
	return a.createWorkspace(ws)
}

// createWorkspace assigns an ID and saves without overwriting, retrying if a
// concurrent create took the same ID.
func (a *App) createWorkspace(ws workspace.Workspace) (workspace.Workspace, error) {
	for attempt := 0; attempt < 5; attempt++ {
		existing := a.deps.Workspaces.List().Workspaces
		ids := make([]string, len(existing))
		for i, w := range existing {
			ids[i] = w.ID
		}
		ws.ID = workspace.NewID(ws.Name, ids)
		err := a.deps.Workspaces.Create(ws)
		if err == nil {
			return ws, nil
		}
		if !errors.Is(err, workspace.ErrExists) {
			return workspace.Workspace{}, fmt.Errorf("워크스페이스를 저장하지 못했습니다: %w", err)
		}
	}
	return workspace.Workspace{}, fmt.Errorf("워크스페이스를 저장하지 못했습니다: 같은 이름이 동시에 만들어지고 있습니다")
}

// DeleteWorkspace removes a workspace.
func (a *App) DeleteWorkspace(id string) error {
	if err := a.unlocked(); err != nil {
		return err
	}
	if err := a.deps.Workspaces.Delete(id); err != nil {
		return fmt.Errorf("워크스페이스를 삭제하지 못했습니다: %w", err)
	}
	return launch.RemoveNotes(a.deps.NotesDir, id)
}

// PickFolder opens a native folder picker and returns the chosen path ("" if cancelled).
func (a *App) PickFolder() (string, error) {
	return a.deps.PickFolder(a.ctx)
}
