package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store reads and writes workspaces as <dir>/<id>.json.
type Store struct {
	dir string
	mu  sync.Mutex // serialises writes; Wails calls bound methods concurrently
}

// NewStore returns a store rooted at dir (typically ~/.work-dashboard/workspaces).
func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

// DefaultDir is the per-user location for workspace files.
func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".work-dashboard", "workspaces"), nil
}

// ListResult holds the workspaces that loaded and a message per file that did
// not, so one broken file never hides the others.
type ListResult struct {
	Workspaces []Workspace `json:"workspaces"`
	Problems   []string    `json:"problems"`
}

// List returns all valid workspaces sorted by ID. A missing directory yields none.
func (s *Store) List() ListResult {
	res := ListResult{Workspaces: []Workspace{}, Problems: []string{}}
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return res
	}
	if err != nil {
		res.Problems = append(res.Problems, fmt.Sprintf("read workspace dir: %v", err))
		return res
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		ws, err := s.load(e.Name())
		if err != nil {
			res.Problems = append(res.Problems, err.Error())
			continue
		}
		res.Workspaces = append(res.Workspaces, ws)
	}
	sort.Slice(res.Workspaces, func(i, j int) bool { return res.Workspaces[i].ID < res.Workspaces[j].ID })
	return res
}

func (s *Store) load(name string) (Workspace, error) {
	data, err := os.ReadFile(filepath.Join(s.dir, name))
	if err != nil {
		return Workspace{}, fmt.Errorf("read %s: %w", name, err)
	}
	var ws Workspace
	if err := json.Unmarshal(data, &ws); err != nil {
		return Workspace{}, fmt.Errorf("parse %s: %w", name, err)
	}
	if want := strings.TrimSuffix(name, ".json"); ws.ID != want {
		return Workspace{}, fmt.Errorf("%s: id %q does not match the file name", name, ws.ID)
	}
	if err := ws.Validate(); err != nil {
		return Workspace{}, fmt.Errorf("%s: %w", name, err)
	}
	return ws, nil
}

// Save validates and writes the workspace atomically.
func (s *Store) Save(ws Workspace) error {
	if err := ws.Validate(); err != nil {
		return fmt.Errorf("save workspace: %w", err)
	}
	data, err := json.MarshalIndent(ws, "", "  ")
	if err != nil {
		return fmt.Errorf("encode workspace %s: %w", ws.ID, err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return fmt.Errorf("create workspace dir: %w", err)
	}
	if err := writeFileAtomic(filepath.Join(s.dir, ws.ID+".json"), data); err != nil {
		return fmt.Errorf("write workspace %s: %w", ws.ID, err)
	}
	return nil
}

// writeFileAtomic writes to a unique temp file, syncs it, then renames it over
// target, so a crash never leaves a truncated target behind.
func writeFileAtomic(target string, data []byte) (err error) {
	f, err := os.CreateTemp(filepath.Dir(target), filepath.Base(target)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}
