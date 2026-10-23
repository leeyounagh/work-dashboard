// Package files gives the UI read-only access to files inside workspace
// folders, and nowhere else.
package files

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// ErrOutside is returned for paths that are not inside any allowed root.
var ErrOutside = errors.New("path is outside the workspace folders")

// hidden entries are never listed.
var hidden = map[string]bool{".git": true}

// Guard restricts access to a set of root folders.
type Guard struct {
	roots     []string // cleaned, as configured
	realRoots []string // symlinks resolved
}

// NewGuard allows paths inside any of roots. Roots that do not exist are ignored.
func NewGuard(roots []string) Guard {
	g := Guard{}
	for _, r := range roots {
		clean := filepath.Clean(r)
		if real, err := filepath.EvalSymlinks(clean); err == nil {
			g.roots = append(g.roots, clean)
			g.realRoots = append(g.realRoots, real)
		}
	}
	return g
}

func insideAny(path string, roots []string) bool {
	for _, root := range roots {
		if sameOrInside(path, root) {
			return true
		}
	}
	return false
}

func sameOrInside(path, root string) bool {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		path, root = strings.ToLower(path), strings.ToLower(root)
	}
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// Resolve returns the real path for an absolute path inside an allowed root.
// Symlinks are resolved first, so a link cannot point outside.
func (g Guard) Resolve(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("%w: %s is not absolute", ErrOutside, path)
	}
	clean := filepath.Clean(path)
	// Check the path as written first, so ../ tricks and missing files outside
	// are reported as outside rather than "not found".
	if !insideAny(clean, g.roots) && !insideAny(clean, g.realRoots) {
		return "", fmt.Errorf("%w: %s", ErrOutside, path)
	}
	real, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return "", err
	}
	// Then check where it really points, so a symlink cannot lead outside.
	if !insideAny(real, g.realRoots) {
		return "", fmt.Errorf("%w: %s", ErrOutside, path)
	}
	return real, nil
}

// ResolveFrom resolves a path that may be relative to base.
func (g Guard) ResolveFrom(base, path string) (string, error) {
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	return g.Resolve(path)
}

// Entry is one item in a directory listing.
type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Dir  bool   `json:"dir"`
	Size int64  `json:"size"`
}

// ListDir lists a directory: folders first, then files, each sorted by name.
func ListDir(g Guard, dir string) ([]Entry, error) {
	real, err := g.Resolve(dir)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(real)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		if hidden[it.Name()] {
			continue
		}
		e := Entry{Name: it.Name(), Path: filepath.Join(dir, it.Name()), Dir: it.IsDir()}
		if info, err := it.Info(); err == nil && !e.Dir {
			e.Size = info.Size()
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Content is a file prepared for the viewer.
type Content struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	Size      int64  `json:"size"`
	Binary    bool   `json:"binary"`
	Truncated bool   `json:"truncated"`
}

// ReadFile reads up to max bytes of a text file. Binary files return no text.
func ReadFile(g Guard, path string, max int64) (Content, error) {
	real, err := g.Resolve(path)
	if err != nil {
		return Content{}, err
	}
	f, err := os.Open(real)
	if err != nil {
		return Content{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Content{}, fmt.Errorf("stat %s: %w", path, err)
	}
	if info.IsDir() {
		return Content{}, fmt.Errorf("%s is a directory", path)
	}
	data, err := io.ReadAll(io.LimitReader(f, max))
	if err != nil {
		return Content{}, fmt.Errorf("read %s: %w", path, err)
	}
	c := Content{Path: path, Size: info.Size(), Truncated: info.Size() > max}
	if bytes.IndexByte(data, 0) >= 0 || (!utf8.Valid(data) && !c.Truncated) {
		c.Binary = true
		return c, nil
	}
	c.Text = string(data)
	return c, nil
}

// Diff returns `git diff` for one file against HEAD ("" when unchanged or untracked).
func Diff(g Guard, path string) (string, error) {
	real, err := g.Resolve(path)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", filepath.Dir(real), "diff", "--no-color", "HEAD", "--", filepath.Base(real))
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("git diff: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("git diff: %w", err)
	}
	return string(out), nil
}
