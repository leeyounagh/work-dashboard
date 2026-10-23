package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
)

const folderWidgetID = "folder-files-aaa111"

func writeAt(t *testing.T, path string, mod time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
}

// folderHarness makes a docs folder and a workspace with a folder widget on it.
func folderHarness(t *testing.T, extra map[string]any) (*harness, string, string, *[]string) {
	t.Helper()
	docs := t.TempDir()
	base := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	writeAt(t, filepath.Join(docs, "2026-10-20_오래된_문서.md"), base)
	writeAt(t, filepath.Join(docs, "2026-10-23_새_문서.html"), base.Add(72*time.Hour))
	writeAt(t, filepath.Join(docs, "run.exe"), base.Add(96*time.Hour))
	writeAt(t, filepath.Join(docs, "tool.py"), base.Add(96*time.Hour)) // not a known document type
	if err := os.Mkdir(filepath.Join(docs, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	settings := map[string]any{"folder": docs}
	for k, v := range extra {
		settings[k] = v
	}
	h, ws, _, _ := localHarness(t, widget.Instance{Type: widget.FolderFiles, ID: folderWidgetID, Title: "문서", Enabled: true, Settings: settings})
	opened := &[]string{}
	h.app.deps.OpenPath = func(p string) error {
		*opened = append(*opened, p)
		return nil
	}
	return h, ws.ID, docs, opened
}

func TestFolderFilesListsNewestDocumentsFirst(t *testing.T) {
	h, wsID, docs, _ := folderHarness(t, nil)
	res := h.app.WidgetData(wsID, 0)
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	d := res.Data.(FolderFilesData)
	if d.Folder != docs || d.Total != 2 || len(d.Files) != 2 {
		t.Fatalf("data = %+v", d)
	}
	if d.Files[0].Name != "2026-10-23_새_문서.html" || d.Files[1].Name != "2026-10-20_오래된_문서.md" {
		t.Fatalf("order = %+v", d.Files)
	}
}

func TestFolderFilesFiltersAndLimits(t *testing.T) {
	h, wsID, _, _ := folderHarness(t, map[string]any{"extensions": []any{"MD"}, "limit": 1})
	d := h.app.WidgetData(wsID, 0).Data.(FolderFilesData)
	if d.Total != 1 || len(d.Files) != 1 || d.Files[0].Name != "2026-10-20_오래된_문서.md" {
		t.Fatalf("data = %+v", d)
	}
}

func TestFolderFilesNeedsFolder(t *testing.T) {
	h, wsID, _, _ := folderHarness(t, map[string]any{"folder": ""})
	if res := h.app.WidgetData(wsID, 0); res.Error == "" {
		t.Fatal("want an error without a folder")
	}
}

func TestOpenWidgetFile(t *testing.T) {
	h, wsID, docs, opened := folderHarness(t, nil)
	if err := h.app.OpenWidgetFile(wsID, folderWidgetID, "2026-10-23_새_문서.html"); err != nil {
		t.Fatal(err)
	}
	if len(*opened) != 1 || (*opened)[0] != filepath.Join(docs, "2026-10-23_새_문서.html") {
		t.Fatalf("opened = %v", *opened)
	}
	for _, name := range []string{
		"run.exe", "run.exe.", "run.exe ", "tool.py", `..\x.md`, "../x.md", "sub", "없는파일.md", "",
		"NUL.md", "con", "x.md:stream",
	} {
		if err := h.app.OpenWidgetFile(wsID, folderWidgetID, name); err == nil {
			t.Errorf("%q: want refusal", name)
		}
	}
	if err := h.app.OpenWidgetFile(wsID, "folder-files-ffffff", "2026-10-23_새_문서.html"); err == nil {
		t.Error("unknown widget: want refusal")
	}
	if len(*opened) != 1 {
		t.Fatalf("refused files were opened: %v", *opened)
	}
}

func TestFolderFilesRejectsNetworkFolders(t *testing.T) {
	for _, dir := range []string{`\\host\share`, `//host/share`, `\\?\C:\x`} {
		if _, err := folderFiles(widgetdata.Settings{"folder": dir}); err == nil {
			t.Errorf("%q: want refusal", dir)
		}
	}
}

func TestFolderFilesClampsLimit(t *testing.T) {
	dir := t.TempDir()
	writeAt(t, filepath.Join(dir, "a.md"), time.Now())
	// limit is validated on save; a hand-edited file must still not panic.
	d, err := folderFiles(widgetdata.Settings{"folder": dir, "limit": -3})
	if err != nil || len(d.Files) != 1 {
		t.Fatalf("folderFiles = %+v, %v", d, err)
	}
}
