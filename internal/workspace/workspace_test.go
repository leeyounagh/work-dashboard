package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/widget"
)

func validWorkspace(t *testing.T) Workspace {
	t.Helper()
	inst, err := widget.NewInstance(widget.PRReviews)
	if err != nil {
		t.Fatal(err)
	}
	return Workspace{
		ID:      "groupware",
		Name:    "그룹웨어",
		Folders: []string{t.TempDir()},
		Widgets: []widget.Instance{inst},
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(Workspace) Workspace
		wantErr string
	}{
		{name: "valid", mutate: func(w Workspace) Workspace { return w }},
		{name: "bad id", mutate: func(w Workspace) Workspace { w.ID = "../etc"; return w }, wantErr: "id"},
		{name: "empty name", mutate: func(w Workspace) Workspace { w.Name = " "; return w }, wantErr: "name"},
		{name: "relative folder", mutate: func(w Workspace) Workspace { w.Folders = []string{"rel/dir"}; return w }, wantErr: "absolute"},
		{name: "duplicate folder", mutate: func(w Workspace) Workspace {
			w.Folders = []string{w.Folders[0], w.Folders[0]}
			return w
		}, wantErr: "duplicate"},
		{name: "invalid widget", mutate: func(w Workspace) Workspace {
			w.Widgets = []widget.Instance{{Type: "nope"}}
			return w
		}, wantErr: "widget"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.mutate(validWorkspace(t)).Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestWithWidgetEnabledReturnsCopy(t *testing.T) {
	orig := validWorkspace(t)
	updated, err := orig.WithWidgetEnabled(0, false)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Widgets[0].Enabled {
		t.Error("widget should be disabled in the copy")
	}
	if !orig.Widgets[0].Enabled {
		t.Error("original must not be mutated")
	}
	if _, err := orig.WithWidgetEnabled(5, true); err == nil {
		t.Error("expected out-of-range error")
	}
}

func TestStoreRoundTrip(t *testing.T) {
	store := NewStore(t.TempDir())
	ws := validWorkspace(t)
	// Every setting kind, including a nil string list, must survive Save → List.
	ws.Widgets = []widget.Instance{{Type: widget.PRReviews, Enabled: true, Settings: map[string]any{
		"scope":             "both",
		"reviewers":         []string{"alice"},
		"repos":             []string(nil),
		"highlightNoReview": false,
		"minApprovals":      2,
	}}}
	second := validWorkspace(t)
	second.ID = "another"

	for _, w := range []Workspace{ws, second} {
		if err := store.Save(w); err != nil {
			t.Fatal(err)
		}
	}
	res := store.List()
	if len(res.Problems) != 0 {
		t.Fatalf("problems: %v", res.Problems)
	}
	if len(res.Workspaces) != 2 || res.Workspaces[0].ID != "another" || res.Workspaces[1].ID != ws.ID {
		t.Fatalf("List() = %+v, want sorted [another groupware]", res.Workspaces)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(store.dir, "*.tmp")); len(leftovers) != 0 {
		t.Fatalf("temp files left behind: %v", leftovers)
	}
}

func TestStoreConcurrentSaves(t *testing.T) {
	store := NewStore(t.TempDir())
	ws := validWorkspace(t)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.Save(ws)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if res := store.List(); len(res.Workspaces) != 1 || len(res.Problems) != 0 {
		t.Fatalf("List() = %+v", res)
	}
}

func TestStoreRejectsFileNameIDMismatch(t *testing.T) {
	store := NewStore(t.TempDir())
	ws := validWorkspace(t)
	if err := store.Save(ws); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(store.dir, ws.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.dir, "copy.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	res := store.List()
	if len(res.Workspaces) != 1 {
		t.Fatalf("want only the matching file loaded, got %+v", res.Workspaces)
	}
	if len(res.Problems) != 1 || !strings.Contains(res.Problems[0], "copy.json") {
		t.Fatalf("problems = %v, want one naming copy.json", res.Problems)
	}
}

func TestStoreRejectsInvalidOnSave(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Save(Workspace{ID: "x"}); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestStoreListMissingDirIsEmpty(t *testing.T) {
	res := NewStore(filepath.Join(t.TempDir(), "missing")).List()
	if len(res.Workspaces) != 0 || len(res.Problems) != 0 {
		t.Fatalf("List() = %+v; want empty", res)
	}
}

func TestStoreListSkipsCorruptFile(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Save(validWorkspace(t)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.dir, "bad.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	res := store.List()
	if len(res.Workspaces) != 1 {
		t.Fatalf("a corrupt file must not hide the valid ones, got %+v", res.Workspaces)
	}
	if len(res.Problems) != 1 || !strings.Contains(res.Problems[0], "bad.json") {
		t.Fatalf("problems = %v, want one naming bad.json", res.Problems)
	}
}

func TestValidateRejectsReservedNames(t *testing.T) {
	ws := validWorkspace(t)
	for _, id := range []string{"con", "nul", "aux", "com1", "lpt9", "prn"} {
		ws.ID = id
		if err := ws.Validate(); err == nil {
			t.Errorf("id %q should be rejected", id)
		}
	}
}

func TestDefaultDir(t *testing.T) {
	dir, err := DefaultDir()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(filepath.ToSlash(dir), ".work-dashboard/workspaces") {
		t.Fatalf("DefaultDir() = %q", dir)
	}
}

func TestSaveFailsWhenDirIsAFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "occupied")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := NewStore(file).Save(validWorkspace(t)); err == nil {
		t.Fatal("expected error when the store dir is a file")
	}
}

func TestListIgnoresNonJSONAndDirs(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := os.WriteFile(filepath.Join(store.dir, "notes.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(store.dir, "sub.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	if res := store.List(); len(res.Workspaces) != 0 || len(res.Problems) != 0 {
		t.Fatalf("List() = %+v, want empty", res)
	}
}

func TestStoreGetAndDelete(t *testing.T) {
	store := NewStore(t.TempDir())
	ws := validWorkspace(t)
	if err := store.Save(ws); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(ws.ID)
	if err != nil || got.Name != ws.Name {
		t.Fatalf("Get() = %+v, %v", got, err)
	}
	if err := store.Delete(ws.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ws.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after delete: err = %v, want ErrNotFound", err)
	}
	if err := store.Delete(ws.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second Delete: err = %v, want ErrNotFound", err)
	}
}

func TestStoreRejectsUnsafeIDs(t *testing.T) {
	store := NewStore(t.TempDir())
	for _, id := range []string{"../x", "", "A", "nul"} {
		if _, err := store.Get(id); err == nil || errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q): err = %v, want invalid id", id, err)
		}
		if err := store.Delete(id); err == nil || errors.Is(err, ErrNotFound) {
			t.Errorf("Delete(%q): err = %v, want invalid id", id, err)
		}
	}
}

func TestNewID(t *testing.T) {
	tests := []struct {
		name     string
		existing []string
		want     string
	}{
		{name: "Acme FE", want: "acme-fe"},
		{name: "  my   work!! ", want: "my-work"},
		{name: "work", existing: []string{"work"}, want: "work-2"},
		{name: "work", existing: []string{"work", "work-2"}, want: "work-3"},
	}
	for _, tt := range tests {
		if got := NewID(tt.name, tt.existing); got != tt.want {
			t.Errorf("NewID(%q, %v) = %q, want %q", tt.name, tt.existing, got, tt.want)
		}
	}
	// Names without ASCII letters (e.g. Korean) still get a valid, unique id.
	id := NewID("그룹웨어", nil)
	if !idPattern.MatchString(id) || !strings.HasPrefix(id, "ws-") {
		t.Errorf("NewID(korean) = %q", id)
	}
	if NewID("그룹웨어", nil) == id {
		t.Error("ids for non-ASCII names should be random")
	}
	if got := NewID("con", nil); reservedID.MatchString(got) {
		t.Errorf("NewID(con) = %q, must not be reserved", got)
	}
}

func TestValidateRejectsNetworkPaths(t *testing.T) {
	ws := validWorkspace(t)
	for _, f := range []string{`\attacker\share`, `\?\C:\x`, `//host/share`} {
		ws.Folders = []string{f}
		if err := ws.Validate(); err == nil {
			t.Errorf("folder %q should be rejected", f)
		}
	}
}

func TestStoreCreateRefusesExisting(t *testing.T) {
	store := NewStore(t.TempDir())
	ws := validWorkspace(t)
	if err := store.Create(ws); err != nil {
		t.Fatal(err)
	}
	if err := store.Create(ws); !errors.Is(err, ErrExists) {
		t.Fatalf("second Create: err = %v, want ErrExists", err)
	}
}

func TestNewIDAvoidsExistingRandomIDs(t *testing.T) {
	// With every 6-hex suffix but one taken this would loop for a long time,
	// so just check a taken random id is never returned.
	first := NewID("그룹웨어", nil)
	for range 50 {
		if NewID("그룹웨어", []string{first}) == first {
			t.Fatal("NewID returned an existing id")
		}
	}
}

func TestValidateWidgetKeysAreUnique(t *testing.T) {
	ws := validWorkspace(t)
	ws.Widgets = []widget.Instance{{Type: widget.PRReviews}, {Type: widget.PRReviews}}
	if err := ws.Validate(); err == nil {
		t.Fatal("two instances of a single widget must be rejected")
	}
	ws.Widgets = []widget.Instance{{Type: widget.Command, ID: "a"}, {Type: widget.Command, ID: "a"}}
	if err := ws.Validate(); err == nil {
		t.Fatal("duplicate custom ids must be rejected")
	}
	ws.Widgets = []widget.Instance{{Type: widget.Command, ID: "a"}, {Type: widget.Command, ID: "b"}, {Type: widget.Links, ID: "c"}}
	if err := ws.Validate(); err != nil {
		t.Fatal(err)
	}
}
