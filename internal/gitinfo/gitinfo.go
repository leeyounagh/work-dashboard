// Package gitinfo reads worktree status with the git CLI.
package gitinfo

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// Worktree is one checkout of a repository.
type Worktree struct {
	Path     string `json:"path"`
	Branch   string `json:"branch"` // "" when detached
	Head     string `json:"head"`
	Ahead    int    `json:"ahead"`  // commits not in the base ref
	Behind   int    `json:"behind"` // base ref commits not in this worktree
	Dirty    int    `json:"dirty"`  // changed or untracked files
	Error    string `json:"error,omitempty"`
	Detached bool   `json:"detached"`
}

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := procutil.Background(exec.CommandContext(ctx, "git", append([]string{"-c", "core.fsmonitor=false", "-C", dir}, args...)...))
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("git %s: %s", args[0], strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("git: %w", err)
	}
	return string(out), nil
}

// ParseWorktrees parses `git worktree list --porcelain`.
func ParseWorktrees(out string) []Worktree {
	var list []Worktree
	var cur *Worktree
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		key, val, _ := strings.Cut(line, " ")
		switch key {
		case "worktree":
			list = append(list, Worktree{Path: filepath.FromSlash(val)})
			cur = &list[len(list)-1]
		case "HEAD":
			if cur != nil {
				cur.Head = val
			}
		case "branch":
			if cur != nil {
				cur.Branch = strings.TrimPrefix(val, "refs/heads/")
			}
		case "detached":
			if cur != nil {
				cur.Detached = true
			}
		case "bare":
			// A bare repository has no working tree to report.
			if cur != nil {
				list = list[:len(list)-1]
				cur = nil
			}
		}
	}
	return list
}

// ParseLeftRight parses `git rev-list --left-right --count A...B` ("2\t5").
func ParseLeftRight(out string) (left, right int, err error) {
	f := strings.Fields(out)
	if len(f) != 2 {
		return 0, 0, fmt.Errorf("unexpected rev-list output %q", out)
	}
	if left, err = strconv.Atoi(f[0]); err != nil {
		return 0, 0, err
	}
	if right, err = strconv.Atoi(f[1]); err != nil {
		return 0, 0, err
	}
	return left, right, nil
}

// refPattern keeps the configured base ref from being read as an option.
var refPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`)

// Worktrees lists the worktrees of the repository containing dir, with their
// distance from baseRef and their uncommitted file count.
func Worktrees(ctx context.Context, dir, baseRef string) ([]Worktree, error) {
	if !refPattern.MatchString(baseRef) || strings.Contains(baseRef, "..") {
		return nil, fmt.Errorf("기준 브랜치 %q 형식이 올바르지 않습니다", baseRef)
	}
	out, err := git(ctx, dir, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	list := ParseWorktrees(out)
	for i := range list {
		wt := &list[i]
		counts, err := git(ctx, wt.Path, "rev-list", "--left-right", "--count", baseRef+"...HEAD", "--")
		if err != nil {
			wt.Error = err.Error()
			continue
		}
		wt.Behind, wt.Ahead, err = ParseLeftRight(counts)
		if err != nil {
			wt.Error = err.Error()
			continue
		}
		status, err := git(ctx, wt.Path, "status", "--porcelain", "--untracked-files=normal")
		if err != nil {
			wt.Error = err.Error()
			continue
		}
		for _, l := range strings.Split(strings.TrimSpace(status), "\n") {
			if l != "" {
				wt.Dirty++
			}
		}
	}
	return list, nil
}
