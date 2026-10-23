package main

import (
	"errors"
	"fmt"

	"github.com/leeyounagh/work-dashboard/internal/launch"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

var errTerminalsLocked = errors.New("개발 모드(wails dev)에서는 보안을 위해 터미널이 잠겨 있습니다. 열려면 WD_DEV_TERMINALS=1 로 실행하세요")

func (a *App) checkTerminals() error {
	if a.deps.TerminalsLocked {
		return errTerminalsLocked
	}
	return nil
}

// loadWorkspace distinguishes a missing workspace from a broken file.
func (a *App) loadWorkspace(id string) (workspace.Workspace, error) {
	ws, err := a.deps.Workspaces.Get(id)
	if errors.Is(err, workspace.ErrNotFound) {
		return ws, fmt.Errorf("워크스페이스를 찾지 못했습니다: %w", err)
	}
	if err != nil {
		return ws, fmt.Errorf("워크스페이스를 읽지 못했습니다: %w", err)
	}
	return ws, nil
}

// defaultWidgets is what a new workspace starts with: every widget, enabled.
// Users switch off what they don't need.
func defaultWidgets() []widget.Instance {
	catalog := widget.Catalog()
	out := make([]widget.Instance, 0, len(catalog))
	for _, def := range catalog {
		inst, err := widget.NewInstance(def.ID)
		if err == nil {
			out = append(out, inst)
		}
	}
	return out
}

// OpenClaude starts Claude Code with every folder of the workspace.
func (a *App) OpenClaude(workspaceID string, cols, rows int) (term.Info, error) {
	if err := a.checkTerminals(); err != nil {
		return term.Info{}, err
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		return term.Info{}, err
	}
	exe, err := a.deps.FindClaude()
	if err != nil {
		return term.Info{}, fmt.Errorf("claude 를 찾지 못했습니다. Claude Code 가 설치돼 있는지 확인하세요: %w", err)
	}
	notes, err := launch.WriteNotes(a.deps.NotesDir, ws)
	if err != nil {
		return term.Info{}, err
	}
	spec, err := launch.ClaudeSpec(ws, launch.ClaudeOptions{
		Exe:       exe,
		SessionID: a.deps.NewSessionID(),
		NotesFile: notes,
	})
	if err != nil {
		return term.Info{}, err
	}
	return a.terms.Open(spec, cols, rows)
}

// OpenShell starts a plain shell in the workspace's first folder.
func (a *App) OpenShell(workspaceID string, cols, rows int) (term.Info, error) {
	if err := a.checkTerminals(); err != nil {
		return term.Info{}, err
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		return term.Info{}, err
	}
	spec, err := launch.ShellSpec(ws, a.deps.Shell)
	if err != nil {
		return term.Info{}, err
	}
	return a.terms.Open(spec, cols, rows)
}

// TermWrite sends keyboard input to a terminal.
func (a *App) TermWrite(id, data string) error {
	if err := a.checkTerminals(); err != nil {
		return err
	}
	return a.terms.Write(id, data)
}

// TermResize resizes a terminal.
func (a *App) TermResize(id string, cols, rows int) error { return a.terms.Resize(id, cols, rows) }

// TermClose terminates a terminal.
func (a *App) TermClose(id string) error { return a.terms.Close(id) }

// Terminals lists running terminals.
func (a *App) Terminals() []term.Info { return a.terms.List() }
