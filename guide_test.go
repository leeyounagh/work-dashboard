package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDetectTech(t *testing.T) {
	back, front, app := t.TempDir(), t.TempDir(), t.TempDir()
	writeFile(t, filepath.Join(back, "go.mod"), "module x\n")
	writeFile(t, filepath.Join(front, "package.json"), `{"dependencies":{"next":"16","react":"19"},"devDependencies":{"typescript":"5","vitest":"5"}}`)
	writeFile(t, filepath.Join(app, "pubspec.yaml"), "name: app\n")
	writeFile(t, filepath.Join(app, "wails.json"), "{}")
	native := t.TempDir()
	writeFile(t, filepath.Join(native, "android", "build.gradle"), "")

	got := detectTech([]string{back, front, app, native, filepath.Join(back, "missing")})
	for _, want := range []string{"go", "nextjs", "react", "typescript", "flutter", "mobile", "wails"} {
		if !slices.Contains(got, want) {
			t.Errorf("detectTech = %v, missing %s", got, want)
		}
	}
	if slices.Contains(got, "vue") {
		t.Errorf("detectTech = %v, has vue", got)
	}
	if got := detectTech(nil); len(got) != 0 {
		t.Errorf("no folders: %v", got)
	}
}

func TestPickArticle(t *testing.T) {
	a := pickArticle([]string{"go"}, func(n int) int { return 0 })
	if a.Tech != "Go" || !strings.HasPrefix(a.URL, "https://") {
		t.Fatalf("go article = %+v", a)
	}
	// Nothing recognised: an AI site.
	a = pickArticle(nil, func(n int) int { return n - 1 })
	if a.Tech != "AI" || !strings.HasPrefix(a.URL, "https://") {
		t.Fatalf("fallback = %+v", a)
	}
	for _, sites := range articleSites {
		for _, s := range sites {
			if !strings.HasPrefix(s.URL, "https://") || s.Name == "" {
				t.Errorf("bad site %+v", s)
			}
		}
	}
}

func TestGuideArticle(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "go.mod"), "module x\n")
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "g", Folders: []string{dir}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := h.app.GuideArticle(ws.ID)
	if err != nil || a.Tech != "Go" {
		t.Fatalf("GuideArticle = %+v, %v", a, err)
	}
	// No workspace selected: still an article (AI).
	if a, err := h.app.GuideArticle(""); err != nil || a.Tech != "AI" {
		t.Fatalf("GuideArticle(\"\") = %+v, %v", a, err)
	}
}

func TestDetectTechInMonorepo(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, "package.json"), `{"devDependencies":{"turbo":"2"}}`)
	writeFile(t, filepath.Join(repo, "apps", "groupware", "package.json"), `{"dependencies":{"next":"16","react":"19"}}`)
	got := detectTech([]string{repo})
	if !slices.Contains(got, "nextjs") || !slices.Contains(got, "react") {
		t.Fatalf("detectTech = %v", got)
	}
}

func TestGuideTopicsOverrideDetection(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "go.mod"), "module x\n")
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "g", Folders: []string{dir}, Topics: []string{"next", "react"}})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		a, err := h.app.GuideArticle(ws.ID)
		if err != nil || (a.Tech != "Next.js" && a.Tech != "React") {
			t.Fatalf("GuideArticle = %+v, %v", a, err)
		}
	}
	// Unknown topics fall back to what the folders show.
	if got := guideTopics([]string{"cobol"}); len(got) != 0 {
		t.Fatalf("guideTopics = %v", got)
	}
	if got := guideTopics([]string{"Next.js", "TS", "golang", "앱"}); !slices.Equal(got, []string{"nextjs", "typescript", "go", "mobile"}) {
		t.Fatalf("guideTopics = %v", got)
	}
}
