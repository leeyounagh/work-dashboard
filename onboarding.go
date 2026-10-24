package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
	"github.com/leeyounagh/work-dashboard/internal/widget"
)

// widgetEnv is what a new workspace's folders and this computer can feed.
type widgetEnv struct {
	GitRepo bool     // a folder is a git repository
	GitHub  bool     // a folder's origin is on GitHub and the gh CLI is logged in
	Repos   []string // those GitHub repositories, "owner/name"
}

// defaultWidgets is what a new workspace starts with: only widgets that work
// without further setup here. Linear, Notion, deploy status and QA need an
// account or settings of their own, so they stay off until the user adds
// them (or asks Claude for suggestions).
func defaultWidgets(env widgetEnv) []widget.Instance {
	ids := []string{}
	if env.GitHub {
		ids = append(ids, widget.PRReviews, widget.CIFailures, widget.ReviewQueue)
	}
	if env.GitRepo {
		ids = append(ids, widget.Worktrees)
	}
	ids = append(ids, widget.ClaudeUsage, widget.SessionRestore)
	out := make([]widget.Instance, 0, len(ids))
	for _, id := range ids {
		inst, err := widget.NewInstance(id)
		if err != nil {
			continue
		}
		// PR widgets start with this workspace's repositories, not every repo.
		if len(env.Repos) > 0 && (id == widget.PRReviews || id == widget.CIFailures || id == widget.ReviewQueue) {
			inst.Settings = map[string]any{"repos": append([]string{}, env.Repos...)}
		}
		out = append(out, inst)
	}
	return out
}

// detectEnv looks at the folders and the gh login. It runs only when a
// workspace is created; only `gh auth status` talks to GitHub.
func (a *App) detectEnv(folders []string) widgetEnv {
	ctx, cancel := context.WithTimeout(a.life, 15*time.Second)
	defer cancel()
	env := widgetEnv{}
	repos := []string{}
	for _, f := range folders {
		if _, err := os.Stat(filepath.Join(f, ".git")); err != nil {
			continue
		}
		env.GitRepo = true
		remote := remoteURL(ctx, f)
		if repo := repoFromRemote(remote); repo != "" && strings.Contains(strings.ToLower(remote), "github.com") && !slices.Contains(repos, repo) {
			repos = append(repos, repo)
		}
	}
	if len(repos) > 0 && a.deps.GitHub != nil {
		if _, err := a.deps.GitHub(ctx, "auth", "status"); err == nil {
			env.GitHub, env.Repos = true, repos
		}
	}
	return env
}

// remoteURL is a folder's origin URL ("" if none).
func remoteURL(ctx context.Context, folder string) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := procutil.Background(exec.CommandContext(ctx, "git", "-C", folder, "remote", "get-url", "origin"))
	cmd.WaitDelay = procutil.WaitDelay
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// needsSetup is a widget that cannot show anything until the user sets it up
// (a command, a folder, a connector). It is shown as a hint, not an error.
type needsSetup struct{ msg string }

func (e needsSetup) Error() string { return e.msg }
