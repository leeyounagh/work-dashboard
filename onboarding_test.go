package main

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

func types(ws []widget.Instance) []string {
	out := []string{}
	for _, w := range ws {
		if w.Enabled {
			out = append(out, w.Type)
		}
	}
	return out
}

func TestDefaultWidgetsFollowTheEnvironment(t *testing.T) {
	base := types(defaultWidgets(widgetEnv{}))
	if !slices.Equal(base, []string{widget.Todo, widget.ClaudeUsage, widget.SessionRestore}) {
		t.Fatalf("no git, no GitHub: %v", base)
	}
	git := types(defaultWidgets(widgetEnv{GitRepo: true}))
	if !slices.Contains(git, widget.Worktrees) || slices.Contains(git, widget.PRReviews) {
		t.Fatalf("git only: %v", git)
	}
	all := types(defaultWidgets(widgetEnv{GitRepo: true, GitHub: true}))
	for _, want := range []string{widget.PRReviews, widget.CIFailures, widget.ReviewQueue, widget.Worktrees} {
		if !slices.Contains(all, want) {
			t.Errorf("GitHub: %v lacks %s", all, want)
		}
	}
	// Widgets that need an account or setup of their own are never on by default.
	for _, off := range []string{widget.LinearIssues, widget.LinearInbox, widget.NotionSpecs, widget.TeamsDeploy, widget.QA2Pass} {
		if slices.Contains(all, off) {
			t.Errorf("%s should start off: %v", off, all)
		}
	}
}

func gitRepo(t *testing.T, remote string) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{{"init", "-q"}, {"remote", "add", "origin", remote}} {
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	return dir
}

func TestNewWorkspaceStartsWithWhatWorks(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	h := newHarness(t)
	gh := gitRepo(t, "https://github.com/someone/project.git")
	other := gitRepo(t, "https://gitlab.example.com/someone/project.git")

	h.app.deps.GitHub = func(_ context.Context, args ...string) ([]byte, error) {
		if slices.Equal(args, []string{"auth", "status"}) {
			return nil, nil
		}
		return nil, errors.New("unexpected gh call")
	}
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "gh", Folders: []string{gh}})
	if err != nil {
		t.Fatal(err)
	}
	if got := types(ws.Widgets); !slices.Contains(got, widget.PRReviews) || !slices.Contains(got, widget.Worktrees) {
		t.Fatalf("GitHub repo + gh login: %v", got)
	}
	// PR widgets start limited to the workspace's own repositories.
	for _, w := range ws.Widgets {
		if w.Type == widget.PRReviews || w.Type == widget.CIFailures || w.Type == widget.ReviewQueue {
			if repos, _ := w.Settings["repos"].([]string); !slices.Equal(repos, []string{"someone/project"}) {
				t.Fatalf("%s repos = %#v", w.Type, w.Settings["repos"])
			}
		}
	}

	// Not on GitHub, or gh not logged in: no PR widgets.
	ws, err = h.app.SaveWorkspace(workspace.Workspace{Name: "lab", Folders: []string{other}})
	if err != nil {
		t.Fatal(err)
	}
	if got := types(ws.Widgets); slices.Contains(got, widget.PRReviews) || !slices.Contains(got, widget.Worktrees) {
		t.Fatalf("non-GitHub remote: %v", got)
	}
	h.app.deps.GitHub = func(context.Context, ...string) ([]byte, error) { return nil, errors.New("not logged in") }
	ws, err = h.app.SaveWorkspace(workspace.Workspace{Name: "nologin", Folders: []string{gh}})
	if err != nil {
		t.Fatal(err)
	}
	if got := types(ws.Widgets); slices.Contains(got, widget.PRReviews) {
		t.Fatalf("gh not logged in: %v", got)
	}
	// A plain folder: nothing git related.
	ws, err = h.app.SaveWorkspace(workspace.Workspace{Name: "plain", Folders: []string{filepath.Join(t.TempDir())}})
	if err != nil {
		t.Fatal(err)
	}
	if got := types(ws.Widgets); slices.Contains(got, widget.Worktrees) {
		t.Fatalf("plain folder: %v", got)
	}
}

func TestWidgetNeedingSetupIsNotAnError(t *testing.T) {
	h, ws, _, _ := localHarness(t, widget.Instance{Type: widget.Command, ID: "command-aaa111", Title: "빈 명령", Enabled: true})
	res := h.app.WidgetData(ws.ID, 0)
	if res.Error != "" || res.Setup == "" {
		t.Fatalf("result = %+v", res)
	}
}
