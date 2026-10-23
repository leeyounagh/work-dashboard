package main

import (
	"errors"
	"fmt"
	"os"

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
	return a.openClaude(ws.ID, launch.ClaudeOptions{Exe: exe, NotesFile: notes}, ws.Folders, ws.Name, cols, rows)
}

// openClaude starts a Claude session connected to the bridge.
func (a *App) openClaude(workspaceID string, opts launch.ClaudeOptions, folders []string, name string, cols, rows int) (term.Info, error) {
	if opts.SessionID == "" {
		opts.SessionID = a.deps.NewSessionID()
	}
	// The session ID doubles as the bridge key: hooks and MCP calls carry it in the URL.
	key := opts.SessionID
	if _, live := a.agents.get(key); live {
		return term.Info{}, errors.New("이 Claude 세션은 이미 열려 있습니다")
	}
	mcpFile, settingsFile, err := a.writeBridgeFiles(key)
	if err != nil {
		return term.Info{}, fmt.Errorf("대시보드 연결 파일을 쓰지 못했습니다: %w", err)
	}
	opts.MCPConfigFile, opts.SettingsFile = mcpFile, settingsFile
	if err := a.agents.add(key, &agentSession{workspaceID: workspaceID, files: nonEmpty(mcpFile, settingsFile)}); err != nil {
		_ = os.Remove(mcpFile)
		_ = os.Remove(settingsFile)
		return term.Info{}, err
	}

	ws := workspace.Workspace{ID: workspaceID, Name: name, Folders: folders}
	spec, err := launch.ClaudeSpec(ws, opts)
	if err == nil {
		var info term.Info
		info, err = a.terms.Open(spec, cols, rows)
		if err == nil {
			a.agents.bindTerm(key, info.ID)
			// The process may have exited before it was bound, in which case
			// its exit event found nothing to clean up.
			if !a.terms.Alive(info.ID) {
				a.endAgentSession(info.ID)
			}
			return info, nil
		}
	}
	if s, ok := a.agents.remove(key); ok {
		for _, f := range s.files {
			_ = os.Remove(f)
		}
	}
	return term.Info{}, err
}

func nonEmpty(items ...string) []string {
	var out []string
	for _, it := range items {
		if it != "" {
			out = append(out, it)
		}
	}
	return out
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
