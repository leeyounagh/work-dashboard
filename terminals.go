package main

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/leeyounagh/work-dashboard/internal/launch"
	"github.com/leeyounagh/work-dashboard/internal/sessions"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

var errDevLocked = errors.New("개발 모드(wails dev)에서는 보안을 위해 잠겨 있습니다. 열려면 WD_DEV_UNLOCK=1 로 실행하세요")

// unlocked guards bindings that run commands or return local data.
func (a *App) unlocked() error {
	if a.deps.DevLocked {
		return errDevLocked
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
	return a.startClaude(workspaceID, launch.ClaudeOptions{}, cols, rows)
}

// startClaude prepares the workspace (claude path, notes) and starts a session.
func (a *App) startClaude(workspaceID string, opts launch.ClaudeOptions, cols, rows int) (term.Info, error) {
	if err := a.unlocked(); err != nil {
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
	opts.Exe, opts.NotesFile = exe, notes
	return a.openClaude(ws.ID, opts, ws.Folders, ws.Name, cols, rows)
}

// ResumeClaude continues an earlier session of this workspace (claude --resume).
func (a *App) ResumeClaude(workspaceID, sessionID string, cols, rows int) (term.Info, error) {
	if a.deps.Sessions == nil {
		return term.Info{}, errors.New("세션 기록을 쓸 수 없습니다")
	}
	if !sessions.ValidID(sessionID) {
		return term.Info{}, errors.New("세션 ID 형식이 올바르지 않습니다")
	}
	rec, ok, err := a.deps.Sessions.Get(sessionID)
	if err != nil {
		return term.Info{}, err
	}
	if !ok || rec.WorkspaceID != workspaceID || rec.Title == "" {
		return term.Info{}, errors.New("이 워크스페이스에서 이어갈 수 있는 세션이 아닙니다")
	}
	return a.startClaude(workspaceID, launch.ClaudeOptions{SessionID: sessionID, Resume: true}, cols, rows)
}

// StartQA opens Claude with "/qa-2pass <domain> <feature> <mode>". Only the
// feature and mode values configured in the workspace's QA widget are accepted.
func (a *App) StartQA(workspaceID, feature, mode string, cols, rows int) (term.Info, error) {
	if err := a.unlocked(); err != nil {
		return term.Info{}, err
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		return term.Info{}, err
	}
	var s widgetdata.Settings
	for _, inst := range ws.Widgets {
		if inst.Type == widget.QA2Pass {
			resolved, err := inst.ResolvedSettings()
			if err != nil {
				return term.Info{}, err
			}
			s = resolved
		}
	}
	if s == nil {
		return term.Info{}, errors.New("이 워크스페이스에 QA 위젯이 없습니다")
	}
	domain := s.String("domain", "")
	if !slices.Contains(s.Strings("features"), feature) || !slices.Contains(qaModes, mode) || !filterPattern.MatchString(feature) {
		return term.Info{}, errors.New("QA 위젯 설정에 없는 기능이나 모드입니다")
	}
	if domain != "" && !filterPattern.MatchString(domain) {
		return term.Info{}, errors.New("QA 도메인 값이 올바르지 않습니다")
	}
	prompt := strings.TrimSpace(strings.Join([]string{"/qa-2pass", domain, feature, mode}, " "))
	return a.startClaude(workspaceID, launch.ClaudeOptions{Prompt: prompt}, cols, rows)
}

// RestorableSessions lists sessions that were open when the app last exited.
// They are handed out once, so reloading the page does not restore again.
func (a *App) RestorableSessions() []sessions.Record {
	if a.unlocked() != nil {
		return []sessions.Record{}
	}
	a.restoreMu.Lock()
	defer a.restoreMu.Unlock()
	out := a.deps.Restorable
	a.deps.Restorable = nil
	if out == nil {
		return []sessions.Record{}
	}
	return out
}

// maxTerminalName keeps tab names readable.
const maxTerminalName = 60

// RenameTerminal gives a terminal tab a name; for Claude it also names the
// session in the history.
func (a *App) RenameTerminal(id, name string) error {
	if err := a.unlocked(); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxTerminalName {
		return fmt.Errorf("이름은 1~%d자로 정하세요", maxTerminalName)
	}
	if err := a.terms.Rename(id, name); err != nil {
		return err
	}
	if key, ok := a.agents.keyForTerm(id); ok && a.deps.Sessions != nil {
		return a.deps.Sessions.Rename(key, name)
	}
	return nil
}

// openClaude starts a Claude session connected to the bridge.
func (a *App) openClaude(workspaceID string, opts launch.ClaudeOptions, folders []string, name string, cols, rows int) (term.Info, error) {
	if opts.SessionID == "" {
		opts.SessionID = a.deps.NewSessionID()
	}
	// The session ID doubles as the bridge key: hooks and MCP calls carry it in the URL.
	key := opts.SessionID
	if !sessions.ValidID(key) {
		return term.Info{}, errors.New("세션 ID 형식이 올바르지 않습니다")
	}
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
			if a.deps.Sessions != nil {
				now := a.now()
				_ = a.deps.Sessions.Started(sessions.Record{SessionID: key, WorkspaceID: workspaceID, StartedAt: now, LastActive: now})
			}
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
	if err := a.unlocked(); err != nil {
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
	if err := a.unlocked(); err != nil {
		return err
	}
	return a.terms.Write(id, data)
}

// TermResize resizes a terminal.
func (a *App) TermResize(id string, cols, rows int) error {
	if err := a.unlocked(); err != nil {
		return err
	}
	return a.terms.Resize(id, cols, rows)
}

// TermClose terminates a terminal.
func (a *App) TermClose(id string) error {
	if err := a.unlocked(); err != nil {
		return err
	}
	return a.terms.Close(id)
}

// Terminals lists running terminals.
func (a *App) Terminals() []term.Info {
	if a.unlocked() != nil {
		return []term.Info{}
	}
	return a.terms.List()
}
