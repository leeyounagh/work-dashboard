// Package sessions remembers the Claude sessions started from the dashboard
// so they can be listed and resumed (claude --resume) after a restart.
package sessions

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/leeyounagh/work-dashboard/internal/fsutil"
)

const (
	maxRecords = 200
	maxTitle   = 80
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`)

// ValidID reports whether id is safe to pass after --resume and to use in a
// file name (no leading dash, no path characters).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// Record is one Claude session.
type Record struct {
	SessionID   string    `json:"sessionId"`
	WorkspaceID string    `json:"workspaceId"`
	Title       string    `json:"title"` // first prompt, shortened
	StartedAt   time.Time `json:"startedAt"`
	LastActive  time.Time `json:"lastActive"`
	Open        bool      `json:"open"`            // running (or running when the app last exited)
	Named       bool      `json:"named,omitempty"` // Title was set by the user
}

// Store keeps records in one JSON file.
type Store struct {
	path string
	mu   sync.Mutex
}

// NewStore uses path, e.g. ~/.work-dashboard/sessions.json.
func NewStore(path string) *Store {
	return &Store{path: path}
}

func (s *Store) load() ([]Record, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sessions: %w", err)
	}
	var recs []Record
	if err := json.Unmarshal(data, &recs); err != nil {
		return nil, fmt.Errorf("parse sessions: %w", err)
	}
	valid := recs[:0]
	for _, r := range recs {
		if ValidID(r.SessionID) {
			valid = append(valid, r)
		}
	}
	return valid, nil
}

func (s *Store) save(recs []Record) error {
	sort.SliceStable(recs, func(i, j int) bool { return recs[i].LastActive.After(recs[j].LastActive) })
	if len(recs) > maxRecords {
		recs = recs[:maxRecords]
	}
	data, err := json.MarshalIndent(recs, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	return fsutil.WriteFileAtomic(s.path, data)
}

// update applies fn to the record with id (if any) under the lock.
func (s *Store) update(id string, fn func(*Record)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.load()
	if err != nil {
		return err
	}
	for i := range recs {
		if recs[i].SessionID == id {
			fn(&recs[i])
			return s.save(recs)
		}
	}
	return nil
}

// Started records a new or resumed session as open.
func (s *Store) Started(r Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.load()
	if err != nil {
		return err
	}
	for i := range recs {
		if recs[i].SessionID == r.SessionID {
			recs[i].Open = true
			recs[i].LastActive = r.LastActive
			return s.save(recs)
		}
	}
	r.Open = true
	return s.save(append(recs, r))
}

func shorten(text string) string {
	if utf8.RuneCountInString(text) <= maxTitle {
		return text
	}
	r := []rune(text)
	return string(r[:maxTitle-1]) + "…"
}

// Touch marks activity; the first prompt becomes the title.
func (s *Store) Touch(id, prompt string, at time.Time) error {
	return s.update(id, func(r *Record) {
		r.LastActive = at
		if r.Title == "" && prompt != "" && !r.Named {
			r.Title = shorten(prompt)
		}
	})
}

// Closed marks a session as no longer running.
func (s *Store) Closed(id string) error {
	return s.update(id, func(r *Record) { r.Open = false })
}

// Get returns one record.
func (s *Store) Get(id string) (Record, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.load()
	if err != nil {
		return Record{}, false, err
	}
	for _, r := range recs {
		if r.SessionID == id {
			return r, true, nil
		}
	}
	return Record{}, false, nil
}

// Recent lists a workspace's resumable sessions (ones with a prompt), newest first.
func (s *Store) Recent(workspaceID string, n int) ([]Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.load()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(recs, func(i, j int) bool { return recs[i].LastActive.After(recs[j].LastActive) })
	out := []Record{}
	for _, r := range recs {
		if r.WorkspaceID == workspaceID && r.Title != "" {
			out = append(out, r)
			if len(out) == n {
				break
			}
		}
	}
	return out, nil
}

// TakeOpenAtExit returns sessions that were still running when the app last
// exited (resumable ones only) and marks every session closed.
func (s *Store) TakeOpenAtExit() ([]Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.load()
	if err != nil {
		return nil, err
	}
	var open []Record
	for i := range recs {
		if recs[i].Open && recs[i].Title != "" {
			open = append(open, recs[i])
		}
		recs[i].Open = false
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return open, s.save(recs)
}

// Rename sets a user-chosen title; later prompts no longer replace it.
func (s *Store) Rename(id, title string) error {
	return s.update(id, func(r *Record) {
		r.Title = shorten(title)
		r.Named = true
	})
}
