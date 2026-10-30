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

	"github.com/leeyounagh/work-dashboard/internal/fsutil"
)

// ErrNotFound is returned when no workspace has the requested ID.
var ErrNotFound = errors.New("workspace not found")

// ErrExists is returned by Create when the ID is already taken.
var ErrExists = errors.New("workspace already exists")

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
	// WD_DATA_DIR points the app at another data folder (demos, screenshots).
	if dir := os.Getenv("WD_DATA_DIR"); dir != "" {
		if !filepath.IsAbs(dir) {
			return "", fmt.Errorf("WD_DATA_DIR must be an absolute path: %q", dir)
		}
		return filepath.Join(dir, "workspaces"), nil
	}
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
	ws.Widgets = withoutRetired(ws.Widgets)
	if err := ws.Validate(); err != nil {
		return Workspace{}, fmt.Errorf("%s: %w", name, err)
	}
	return ws, nil
}

// Create saves a new workspace, refusing to overwrite an existing one.
func (s *Store) Create(ws Workspace) error {
	return s.write(ws, true)
}

// Save validates and writes the workspace atomically, replacing any existing one.
func (s *Store) Save(ws Workspace) error {
	return s.write(ws, false)
}

func (s *Store) write(ws Workspace, createOnly bool) error {
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
	target := filepath.Join(s.dir, ws.ID+".json")
	if createOnly {
		// Checked under s.mu, so two concurrent creates cannot both pass.
		if _, err := os.Stat(target); err == nil {
			return fmt.Errorf("%w: %s", ErrExists, ws.ID)
		}
	}
	if err := fsutil.WriteFileAtomic(target, data); err != nil {
		return fmt.Errorf("write workspace %s: %w", ws.ID, err)
	}
	return nil
}

func checkID(id string) error {
	if !idPattern.MatchString(id) || reservedID.MatchString(id) {
		return fmt.Errorf("invalid workspace id %q", id)
	}
	return nil
}

// Get loads one workspace by ID.
func (s *Store) Get(id string) (Workspace, error) {
	if err := checkID(id); err != nil {
		return Workspace{}, err
	}
	ws, err := s.load(id + ".json")
	if errors.Is(err, fs.ErrNotExist) {
		return Workspace{}, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	return ws, err
}

// Delete removes a workspace file.
func (s *Store) Delete(id string) error {
	if err := checkID(id); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(filepath.Join(s.dir, id+".json"))
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	if err != nil {
		return fmt.Errorf("delete workspace %s: %w", id, err)
	}
	return nil
}
