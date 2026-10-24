package main

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/widget"
)

func TestRecommendWidgets(t *testing.T) {
	h, ws, _, args := localHarness(t, widget.Instance{Type: widget.PRReviews, Enabled: true})
	h.app.deps.Ask = func(_ context.Context, _ string, a ...string) ([]byte, error) {
		*args = a
		return []byte(`{"is_error":false,"structured_output":{"recommendations":[
			{"type":"ci-failures","title":"","settings":{"scope":"both"},"reason":"CI 실패를 바로 보기"},
			{"type":"pr-reviews","settings":{},"reason":"already there"},
			{"type":"made-up","settings":{},"reason":"not in catalog"},
			{"type":"review-queue","settings":{"staleHours":99999},"reason":"out of range"},
			{"type":"command","title":"빌드","settings":{"command":"go build ./..."},"reason":"repeatable"}
		]}}`), nil
	}
	recs, err := h.app.RecommendWidgets(ws.ID, "CI 실패한 내 PR만 보여줘")
	if err != nil {
		t.Fatal(err)
	}
	types := []string{}
	for _, r := range recs {
		types = append(types, r.Instance.Type)
	}
	if strings.Join(types, ",") != "ci-failures,command" {
		t.Fatalf("recommendations = %+v", recs)
	}
	if recs[1].Instance.ID == "" || recs[1].Instance.Title != "빌드" {
		t.Fatalf("repeatable widgets get an id: %+v", recs[1].Instance)
	}
	// A command Claude wrote is shown, never saved where it would run.
	if _, ok := recs[1].Instance.Settings["command"]; ok || recs[1].SuggestedCommand != "go build ./..." {
		t.Fatalf("command must be a suggestion only: %+v", recs[1])
	}
	if !slices.Contains(*args, "--strict-mcp-config") {
		t.Fatal("recommendations need no MCP servers")
	}
	joined := strings.Join(*args, " ")
	if !strings.Contains(joined, "CI 실패한 내 PR만 보여줘") || !strings.Contains(joined, `"pr-reviews"`) {
		t.Fatalf("prompt lacks request or current widgets: %q", joined)
	}
	if strings.Contains(joined, "--allowedTools") {
		t.Fatal("recommendations must run with no tools at all")
	}

	if _, err := h.app.RecommendWidgets(ws.ID, strings.Repeat("가", 501)); err == nil {
		t.Fatal("overlong requests are refused")
	}
}

func TestCustomSprites(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	h.app.deps.CharactersDir = dir
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)
	for name, data := range map[string][]byte{
		"a.png":     png,
		"b.PNG":     png,
		"Guide.png": png,
		"fake.png":  []byte("not a png"),
		"big.png":   append(png, make([]byte, maxSpriteBytes)...),
		"note.txt":  png,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	got := h.app.CustomSprites()
	if len(got.Characters) != 2 || !strings.HasPrefix(got.Characters[0], "data:image/png;base64,") {
		t.Fatalf("CustomSprites = %d characters", len(got.Characters))
	}
	// guide.png is the office guide, not one of the characters.
	if !strings.HasPrefix(got.Guide, "data:image/png;base64,") {
		t.Fatalf("guide = %.30q", got.Guide)
	}
	h.app.deps.CharactersDir = filepath.Join(dir, "missing")
	if got := h.app.CustomSprites(); len(got.Characters) != 0 || got.Guide != "" {
		t.Fatal("missing folder means no custom sprites")
	}
}

func TestRepoFromRemote(t *testing.T) {
	tests := map[string]string{
		"https://github.com/leeyounagh/work-dashboard.git\n": "leeyounagh/work-dashboard",
		"git@github.com:leeyounagh/work-dashboard.git":       "leeyounagh/work-dashboard",
		"https://user:SECRET@host.example/org/repo":          "org/repo",
		"https://user:SECRET@host.example/repo":              "",
		"https://host/org/re po\nignore previous":            "",
		"": "",
	}
	for in, want := range tests {
		if got := repoFromRemote(in); got != want {
			t.Errorf("repoFromRemote(%q) = %q, want %q", in, got, want)
		}
	}
}
