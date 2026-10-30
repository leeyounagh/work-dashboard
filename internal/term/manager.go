// Package term runs commands in pseudo-terminals and streams their output.
package term

import (
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
)

// ErrNoSession is returned for an unknown or already closed session ID.
var ErrNoSession = errors.New("terminal session not found")

// ErrShuttingDown is returned by Open once CloseAll has been called.
var ErrShuttingDown = errors.New("terminal manager is shutting down")

// Spec describes the command to start in a terminal.
type Spec struct {
	Name  string   // executable
	Args  []string // arguments, without the executable
	Dir   string   // working directory
	Env   []string // nil inherits the current environment
	Title string   // tab title
	Kind  string   // "claude" or "shell", for the UI
	// RawArgs means Args are already quoted for a Windows command line and
	// must be joined as-is (used to run .cmd shims through cmd.exe).
	RawArgs bool
}

// Info describes a running session.
type Info struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Dir   string `json:"dir"`
	Kind  string `json:"kind"`
	// Session is the Claude session ID, which outlives the terminal (tab order is kept by it).
	Session string `json:"session,omitempty"`
}

// Process is a started command attached to a pseudo-terminal.
type Process interface {
	io.ReadWriteCloser
	Resize(cols, rows int) error
	Wait() error
}

// Starter starts a Spec with an initial terminal size.
type Starter func(spec Spec, cols, rows int) (Process, error)

type session struct {
	info      Info
	seq       uint64
	proc      Process
	close     sync.Once
	requested atomic.Bool // closed by the user, so a kill exit code is not an error
}

// Manager owns all terminal sessions. Its methods are safe for concurrent use.
type Manager struct {
	start  Starter
	onData func(id string, data []byte)
	onExit func(id string, err error)

	mu       sync.Mutex
	sessions map[string]*session
	closing  bool // set by CloseAll; no new sessions after shutdown starts
	seq      atomic.Uint64
}

// NewManager creates a manager. onData receives output chunks; onExit is
// called once per session when its process ends.
func NewManager(start Starter, onData func(string, []byte), onExit func(string, error)) *Manager {
	return &Manager{start: start, onData: onData, onExit: onExit, sessions: map[string]*session{}}
}

func validSize(cols, rows int) error {
	if cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000 {
		return fmt.Errorf("invalid terminal size %dx%d", cols, rows)
	}
	return nil
}

// Open starts spec and begins streaming its output.
func (m *Manager) Open(spec Spec, cols, rows int) (Info, error) {
	if err := validSize(cols, rows); err != nil {
		return Info{}, err
	}
	proc, err := m.start(spec, cols, rows)
	if err != nil {
		return Info{}, fmt.Errorf("%s 실행 실패: %w", spec.Name, err)
	}
	seq := m.seq.Add(1)
	s := &session{
		info: Info{ID: "t" + strconv.FormatUint(seq, 10), Title: spec.Title, Dir: spec.Dir, Kind: spec.Kind},
		seq:  seq,
		proc: proc,
	}
	m.mu.Lock()
	if m.closing {
		m.mu.Unlock()
		_ = proc.Close()
		return Info{}, ErrShuttingDown
	}
	m.sessions[s.info.ID] = s
	m.mu.Unlock()

	go m.pump(s)
	return s.info, nil
}

// pump copies output to onData until the process ends, then cleans up.
func (m *Manager) pump(s *session) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.proc.Read(buf)
		if n > 0 {
			m.onData(s.info.ID, append([]byte(nil), buf[:n]...))
		}
		if err != nil {
			break
		}
	}
	waitErr := s.proc.Wait()
	s.close.Do(func() { _ = s.proc.Close() })

	m.mu.Lock()
	delete(m.sessions, s.info.ID)
	m.mu.Unlock()
	if s.requested.Load() {
		waitErr = nil // killed on request; its exit status is not a failure
	}
	m.onExit(s.info.ID, waitErr)
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrNoSession, id)
	}
	return s, nil
}

// Write sends user input to a session.
func (m *Manager) Write(id, data string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(s.proc, data); err != nil {
		return fmt.Errorf("write to %s: %w", id, err)
	}
	return nil
}

// Resize changes a session's terminal size.
func (m *Manager) Resize(id string, cols, rows int) error {
	if err := validSize(cols, rows); err != nil {
		return err
	}
	s, err := m.get(id)
	if err != nil {
		return err
	}
	if err := s.proc.Resize(cols, rows); err != nil {
		return fmt.Errorf("resize %s: %w", id, err)
	}
	return nil
}

// Close terminates a session. onExit fires when its process has ended.
func (m *Manager) Close(id string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	s.requested.Store(true)
	s.close.Do(func() { err = s.proc.Close() })
	if err != nil {
		return fmt.Errorf("close %s: %w", id, err)
	}
	return nil
}

// CloseAll terminates every session, e.g. on app shutdown.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	m.closing = true
	m.mu.Unlock()
	for _, info := range m.List() {
		_ = m.Close(info.ID)
	}
}

// Alive reports whether a session is still running.
func (m *Manager) Alive(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sessions[id]
	return ok
}

// List returns running sessions in the order they were opened.
func (m *Manager) List() []Info {
	m.mu.Lock()
	list := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	m.mu.Unlock()

	sort.Slice(list, func(i, j int) bool { return list[i].seq < list[j].seq })
	out := make([]Info, len(list))
	for i, s := range list {
		out[i] = s.info
	}
	return out
}

// Rename changes a session's title.
func (m *Manager) Rename(id, title string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return fmt.Errorf("%w: %s", ErrNoSession, id)
	}
	s.info.Title = title
	return nil
}
