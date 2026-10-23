package main

import (
	"fmt"

	"github.com/leeyounagh/work-dashboard/internal/files"
)

// maxViewBytes caps what the viewer loads for one file.
const maxViewBytes = 2 << 20 // 2 MiB

// guard allows every folder of every saved workspace.
func (a *App) guard() files.Guard {
	var roots []string
	for _, ws := range a.deps.Workspaces.List().Workspaces {
		roots = append(roots, ws.Folders...)
	}
	return files.NewGuard(roots)
}

// ListDir lists a folder inside a workspace.
func (a *App) ListDir(path string) ([]files.Entry, error) {
	entries, err := files.ListDir(a.guard(), path)
	if err != nil {
		return nil, fmt.Errorf("폴더를 열지 못했습니다: %w", err)
	}
	return entries, nil
}

// ReadFile returns a file for the viewer.
func (a *App) ReadFile(path string) (files.Content, error) {
	c, err := files.ReadFile(a.guard(), path, maxViewBytes)
	if err != nil {
		return files.Content{}, fmt.Errorf("파일을 열지 못했습니다: %w", err)
	}
	return c, nil
}

// FileDiff returns uncommitted changes of a file.
func (a *App) FileDiff(path string) (string, error) {
	d, err := files.Diff(a.guard(), path)
	if err != nil {
		return "", fmt.Errorf("변경 내용을 가져오지 못했습니다: %w", err)
	}
	return d, nil
}
