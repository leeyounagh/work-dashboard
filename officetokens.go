package main

import (
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/bridge"
	"github.com/leeyounagh/work-dashboard/internal/tokens"
)

// eventTokens reports a session's token count (drives the office decor).
const eventTokens = "agent:tokens"

// tokenReadEvery throttles transcript reads while Claude is working; Stop
// always reads.
const tokenReadEvery = 5 * time.Second

// tokenLedger keeps daily token totals.
type tokenLedger interface {
	Add(n int64) (tokens.Totals, error)
	Totals() tokens.Totals
}

// TokenEvent is a session's tokens since the dashboard opened it, with the
// day's and week's totals across sessions.
type TokenEvent struct {
	TermID string `json:"termId"`
	Tokens int64  `json:"tokens"`
	Today  int64  `json:"today"`
	Week   int64  `json:"week"`
}

// sessionTokens follows one session's transcript.
type sessionTokens struct {
	mu       sync.Mutex // one read at a time
	path     string
	reader   tokens.Reader
	primed   bool // earlier history (a resumed session) is skipped
	total    int64
	lastRead time.Time
}

type tokenTracker struct {
	mu       sync.Mutex
	sessions map[string]*sessionTokens // by session key
	// spawn runs a read off the hook goroutine (tests run it inline).
	spawn func(func())
}

func newTokenTracker() *tokenTracker {
	return &tokenTracker{sessions: map[string]*sessionTokens{}, spawn: func(f func()) { go f() }}
}

// open starts following a session the dashboard launched.
func (t *tokenTracker) open(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.sessions[key] = &sessionTokens{}
}

// due returns the session to read now, or nil when this hook does not need a
// read. Sessions not opened (or already forgotten) are never read.
func (t *tokenTracker) due(key string, ev bridge.HookEvent, now time.Time) *sessionTokens {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := t.sessions[key]
	if s == nil {
		return nil
	}
	switch ev.Event {
	case "SessionStart", "UserPromptSubmit", "Stop", "SessionEnd":
		// The first of these sets the baseline; reads after it are cheap.
	case "PostToolUse":
		if now.Sub(s.lastRead) < tokenReadEvery {
			return nil
		}
	default:
		return nil
	}
	s.lastRead = now
	return s
}

func (t *tokenTracker) forget(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.sessions, key)
}

// validTranscript accepts only Claude's own transcript for the session: a
// local, absolute <session_id>.jsonl path. Network and device paths
// (\\host\share, \\.\pipe) are refused: opening one can hang or send
// Windows credentials to the host.
func validTranscript(ev bridge.HookEvent) bool {
	p := ev.TranscriptPath
	if strings.HasPrefix(p, `\\`) || strings.HasPrefix(p, "//") {
		return false
	}
	return p != "" && ev.SessionID != "" && filepath.IsAbs(p) &&
		strings.EqualFold(filepath.Base(p), ev.SessionID+".jsonl")
}

// trackTokens reads the transcript off the hook goroutine (Claude waits for hooks).
func (a *App) trackTokens(key, termID string, ev bridge.HookEvent) {
	if a.deps.Tokens == nil || !validTranscript(ev) {
		return
	}
	s := a.tokens.due(key, ev, a.now())
	if s == nil {
		return
	}
	a.tokens.spawn(func() { a.countTokens(s, termID, ev.TranscriptPath) })
}

func (a *App) countTokens(s *sessionTokens, termID, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path != path {
		// A new transcript (first hook, /clear, resume): start from its end.
		s.path, s.reader, s.primed = path, tokens.Reader{}, false
	}
	if !s.primed {
		// History already there (a resumed session) is not today's work. A
		// transcript not written yet is primed by a later hook instead.
		exists, err := s.reader.SkipToEnd(path)
		if err != nil {
			log.Printf("work-dashboard: token count: %v", err)
		}
		s.primed = exists
		return
	}
	n, err := s.reader.Read(path)
	if err != nil {
		log.Printf("work-dashboard: token count: %v", err)
		return
	}
	if n == 0 {
		return
	}
	s.total += n
	totals, err := a.deps.Tokens.Add(n)
	if err != nil {
		log.Printf("work-dashboard: %v", err)
	}
	a.deps.Emit(a.ctx, eventTokens, TokenEvent{TermID: termID, Tokens: s.total, Today: totals.Today, Week: totals.Week})
}

// OfficeTokens returns today's and this week's token totals.
func (a *App) OfficeTokens() tokens.Totals {
	if a.unlocked() != nil || a.deps.Tokens == nil {
		return tokens.Totals{}
	}
	return a.deps.Tokens.Totals()
}
