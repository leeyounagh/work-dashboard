package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/files"
)

// maxViewBytes caps what the viewer loads for one file.
const maxViewBytes = 2 << 20 // 2 MiB

// workspaceRoots are the folders of every saved workspace.
func (a *App) workspaceRoots() []string {
	var roots []string
	for _, ws := range a.deps.Workspaces.List().Workspaces {
		roots = append(roots, ws.Folders...)
	}
	return roots
}

// guard allows every folder of every saved workspace.
func (a *App) guard() files.Guard {
	return files.NewGuard(a.workspaceRoots())
}

// viewerGuard also allows the files Claude touched in this run, which are
// listed under 「최근 본 파일」 even when they are outside the workspaces.
func (a *App) viewerGuard() files.Guard {
	return a.guard().WithPins(a.seen.pins())
}

// viewError says why a file cannot be shown, in words the user can act on.
func viewError(path string, err error) error {
	if _, statErr := os.Stat(path); errors.Is(statErr, fs.ErrNotExist) {
		return fmt.Errorf("파일이 없습니다 (지워졌거나 옮겨졌습니다): %s", path)
	}
	if errors.Is(err, files.ErrOutside) {
		return fmt.Errorf("워크스페이스 폴더 밖의 파일이라 열 수 없습니다: %s", path)
	}
	return fmt.Errorf("파일을 열지 못했습니다: %w", err)
}

// ListDir lists a folder inside a workspace.
func (a *App) ListDir(path string) ([]files.Entry, error) {
	if err := a.unlocked(); err != nil {
		return nil, err
	}
	entries, err := files.ListDir(a.guard(), path)
	if err != nil {
		return nil, fmt.Errorf("폴더를 열지 못했습니다: %w", err)
	}
	return entries, nil
}

// ReadFile returns a file for the viewer.
func (a *App) ReadFile(path string) (files.Content, error) {
	if err := a.unlocked(); err != nil {
		return files.Content{}, err
	}
	c, err := files.ReadFile(a.viewerGuard(), path, maxViewBytes)
	if err != nil {
		return files.Content{}, viewError(path, err)
	}
	return c, nil
}

// FileDiff returns uncommitted changes of a file.
func (a *App) FileDiff(path string) (string, error) {
	if err := a.unlocked(); err != nil {
		return "", err
	}
	d, err := files.Diff(a.viewerGuard(), path)
	if err != nil {
		if strings.Contains(err.Error(), "not a git repository") {
			return "", nil // a file outside any repo has no changes to show
		}
		if errors.Is(err, files.ErrOutside) || errors.Is(err, fs.ErrNotExist) {
			return "", viewError(path, err)
		}
		return "", fmt.Errorf("변경 내용을 가져오지 못했습니다: %w", err)
	}
	return d, nil
}

// searchLimit and searchTimeout keep file search responsive in big repos.
const (
	searchLimit   = 100
	searchTimeout = 3 * time.Second
)

// SearchFiles finds files by name or path in a workspace's folders.
func (a *App) SearchFiles(workspaceID, query string) (files.SearchResult, error) {
	if err := a.unlocked(); err != nil {
		return files.SearchResult{}, err
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		return files.SearchResult{}, err
	}
	ctx, cancel := context.WithTimeout(a.life, searchTimeout)
	defer cancel()
	return files.Search(ctx, files.NewGuard(ws.Folders), ws.Folders, query, searchLimit)
}
