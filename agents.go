package main

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/leeyounagh/work-dashboard/internal/bridge"
	"github.com/leeyounagh/work-dashboard/internal/files"
	"github.com/leeyounagh/work-dashboard/internal/fsutil"
)

// Events emitted for Claude sessions started by the dashboard.
const (
	eventAgent     = "agent:event" // hook activity, drives the office characters
	eventFilesOpen = "files:open"  // Claude asked to show files (open_files tool)
	eventFilesSeen = "files:seen"  // Claude read or edited a file
)

// claudeBridge is the part of the bridge server the app needs.
type claudeBridge interface {
	ClaudeConfig(session string) (mcpConfig, settings []byte)
}

// AgentEvent is a simplified hook event for the UI.
type AgentEvent struct {
	TermID  string `json:"termId"`
	Event   string `json:"event"`
	Tool    string `json:"tool,omitempty"`
	File    string `json:"file,omitempty"`
	Message string `json:"message,omitempty"`
}

// FilesEvent lists files for the file tree.
type FilesEvent struct {
	TermID      string   `json:"termId"`
	WorkspaceID string   `json:"workspaceId"`
	Paths       []string `json:"paths"`
	Tool        string   `json:"tool,omitempty"`
}

// agentSession links a Claude session key (used in bridge URLs) to its terminal.
type agentSession struct {
	termID      string
	workspaceID string
	files       []string // run files to delete when the session ends
}

type agentRegistry struct {
	mu       sync.Mutex
	sessions map[string]*agentSession // by session key
	byTerm   map[string]string        // term ID -> session key
}

func newAgentRegistry() *agentRegistry {
	return &agentRegistry{sessions: map[string]*agentSession{}, byTerm: map[string]string{}}
}

func (r *agentRegistry) add(key string, s *agentSession) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[key] = s
}

func (r *agentRegistry) bindTerm(key, termID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.sessions[key]; ok {
		s.termID = termID
		r.byTerm[termID] = key
	}
}

func (r *agentRegistry) get(key string) (agentSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[key]
	if !ok {
		return agentSession{}, false
	}
	return *s, true
}

// remove forgets a session and returns it.
func (r *agentRegistry) remove(key string) (agentSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[key]
	if !ok {
		return agentSession{}, false
	}
	delete(r.sessions, key)
	delete(r.byTerm, s.termID)
	return *s, true
}

func (r *agentRegistry) keyForTerm(termID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key, ok := r.byTerm[termID]
	return key, ok
}

// writeBridgeFiles writes the per-session MCP config and hook settings.
// They contain the bridge token, so they live in the user's private run dir
// and are removed when the session ends.
func (a *App) writeBridgeFiles(key string) (mcpFile, settingsFile string, err error) {
	if a.deps.Bridge == nil {
		return "", "", nil
	}
	if err := os.MkdirAll(a.deps.RunDir, 0o700); err != nil {
		return "", "", err
	}
	mcp, settings := a.deps.Bridge.ClaudeConfig(key)
	mcpFile = filepath.Join(a.deps.RunDir, key+".mcp.json")
	settingsFile = filepath.Join(a.deps.RunDir, key+".settings.json")
	if err := fsutil.WriteFileAtomic(mcpFile, mcp); err != nil {
		return "", "", err
	}
	if err := fsutil.WriteFileAtomic(settingsFile, settings); err != nil {
		_ = os.Remove(mcpFile)
		return "", "", err
	}
	return mcpFile, settingsFile, nil
}

// endAgentSession cleans up after a terminal that ran Claude.
func (a *App) endAgentSession(termID string) {
	key, ok := a.agents.keyForTerm(termID)
	if !ok {
		return
	}
	if s, ok := a.agents.remove(key); ok {
		for _, f := range s.files {
			_ = os.Remove(f)
		}
	}
}

// onHook turns a Claude hook into UI events.
func (a *App) onHook(key string, ev bridge.HookEvent) {
	s, ok := a.agents.get(key)
	if !ok || s.termID == "" {
		return
	}
	a.deps.Emit(a.ctx, eventAgent, AgentEvent{
		TermID: s.termID, Event: ev.Event, Tool: ev.ToolName, File: ev.FilePath(), Message: ev.Message,
	})
	if ev.Event == "PostToolUse" && ev.FilePath() != "" {
		a.deps.Emit(a.ctx, eventFilesSeen, FilesEvent{
			TermID: s.termID, WorkspaceID: s.workspaceID, Paths: []string{ev.FilePath()}, Tool: ev.ToolName,
		})
	}
}

// onOpenFiles handles the open_files MCP tool for a session.
func (a *App) onOpenFiles(key string, paths []string) ([]string, error) {
	s, ok := a.agents.get(key)
	if !ok {
		return nil, errors.New("unknown session")
	}
	ws, err := a.deps.Workspaces.Get(s.workspaceID)
	if err != nil {
		return nil, err
	}
	guard := files.NewGuard(ws.Folders)
	base := ""
	if len(ws.Folders) > 0 {
		base = ws.Folders[0]
	}
	var opened, failed []string
	for _, p := range paths {
		real, err := guard.ResolveFrom(base, p)
		if err != nil {
			failed = append(failed, p)
			continue
		}
		opened = append(opened, real)
	}
	if len(opened) == 0 {
		return nil, errors.New("none of the paths exist inside this workspace's folders")
	}
	a.deps.Emit(a.ctx, eventFilesOpen, FilesEvent{TermID: s.termID, WorkspaceID: s.workspaceID, Paths: opened})
	if len(failed) > 0 {
		opened = append(opened, "(skipped, not in the workspace: "+joinShort(failed)+")")
	}
	return opened, nil
}

func joinShort(items []string) string {
	out := ""
	for i, it := range items {
		if i == 5 {
			return out + ", …"
		}
		if i > 0 {
			out += ", "
		}
		out += it
	}
	return out
}
