package main

import (
	"path/filepath"
	"sync"

	"github.com/leeyounagh/work-dashboard/internal/files"
)

// maxSeenFiles bounds the files remembered from Claude's tool calls.
const maxSeenFiles = 500

// seenFiles are files Claude read or edited during this run. The viewer may
// open them even outside the workspace folders: they are listed under
// 「최근 본 파일」, and Claude has already read them. Each is pinned to what
// it really was then, so a later swap for a link does not open the target.
type seenFiles struct {
	mu    sync.Mutex
	order []files.Pin // oldest first
}

// add pins path; folders, missing and relative paths are skipped.
func (s *seenFiles) add(path string) {
	pin, err := files.PinFile(path)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, p := range s.order {
		if filepath.Clean(p.Path) == pin.Path {
			// Re-read: pin again to what it is now, as the newest.
			s.order = append(s.order[:i:i], s.order[i+1:]...)
			break
		}
	}
	s.order = append(s.order, pin)
	if len(s.order) > maxSeenFiles {
		s.order = s.order[1:]
	}
}

// pins returns the remembered files.
func (s *seenFiles) pins() []files.Pin {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]files.Pin(nil), s.order...)
}
