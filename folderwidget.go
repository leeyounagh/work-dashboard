package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
)

// FolderFile is one document in a folder widget.
type FolderFile struct {
	Name     string    `json:"name"`
	Modified time.Time `json:"modified"`
	Size     int64     `json:"size"`
}

// FolderFilesData feeds the folder documents widget.
type FolderFilesData struct {
	Folder string       `json:"folder"`
	Files  []FolderFile `json:"files"`
	Total  int          `json:"total"` // matching files in the folder
	Limit  int          `json:"limit"` // how many to show when not searching
}

// maxFolderFiles caps what is sent to the page (and searched there).
const maxFolderFiles = 1000

// Only documents are listed and opened: opening anything else with its
// default app may run code (.exe, .lnk, .chm, .py, ...), so this is an
// allowlist rather than a list of dangerous types.
var documentExt = map[string]bool{
	".md": true, ".txt": true, ".log": true, ".csv": true, ".json": true, ".yaml": true, ".yml": true,
	".html": true, ".htm": true, ".pdf": true, ".rtf": true,
	".docx": true, ".xlsx": true, ".pptx": true, ".doc": true, ".xls": true, ".ppt": true,
	".hwp": true, ".hwpx": true, ".odt": true, ".ods": true, ".odp": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
}

// Reserved device names (CON, NUL.md, COM1.txt, ...) are not files.
var deviceName = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)`)

// isDocument reports whether name is a plain document name that Windows
// opens as itself: no trailing dot/space or stream suffix to disguise it.
func isDocument(name string) bool {
	if name == "" || strings.ContainsAny(name, `/\:`) || strings.TrimRight(name, ". ") != name || deviceName.MatchString(name) {
		return false
	}
	return documentExt[strings.ToLower(filepath.Ext(name))]
}

// isNetworkPath reports UNC and device paths (\\host\share, \\?\...):
// reading one can send the Windows login hash to another machine.
func isNetworkPath(dir string) bool {
	return strings.HasPrefix(dir, `\\`) || strings.HasPrefix(dir, "//")
}

// extFilter turns "md, .HTML" style settings into a set of ".md", ".html" (nil = any).
func extFilter(values []string) map[string]bool {
	var set map[string]bool
	for _, v := range values {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			continue
		}
		if !strings.HasPrefix(v, ".") {
			v = "." + v
		}
		if set == nil {
			set = map[string]bool{}
		}
		set[v] = true
	}
	return set
}

func folderFiles(s widgetdata.Settings) (FolderFilesData, error) {
	dir := strings.TrimSpace(s.String("folder", ""))
	d := FolderFilesData{Folder: dir, Files: []FolderFile{}}
	if dir == "" {
		return d, needsSetup{"「설정」에 볼 폴더 경로를 넣으면 문서가 보입니다"}
	}
	if isNetworkPath(dir) {
		return d, errors.New("네트워크 경로(\\\\…)는 볼 수 없습니다. 이 컴퓨터의 폴더를 지정하세요")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return d, fmt.Errorf("폴더를 읽지 못했습니다: %w", err)
	}
	only := extFilter(s.Strings("extensions"))
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if !e.Type().IsRegular() || !isDocument(e.Name()) || (only != nil && !only[ext]) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		d.Files = append(d.Files, FolderFile{Name: e.Name(), Modified: info.ModTime(), Size: info.Size()})
	}
	sort.SliceStable(d.Files, func(i, j int) bool { return d.Files[i].Modified.After(d.Files[j].Modified) })
	d.Total = len(d.Files)
	d.Limit = max(1, s.Int("limit", 20))
	if len(d.Files) > maxFolderFiles {
		d.Files = d.Files[:maxFolderFiles]
	}
	return d, nil
}

// OpenWidgetFile opens a document listed by a folder widget with its default
// app. Only a document directly inside that widget's saved folder can be
// opened, never a path sent by the page or a file type that runs code.
func (a *App) OpenWidgetFile(workspaceID, widgetID, name string) error {
	if err := a.unlocked(); err != nil {
		return err
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		return err
	}
	var folder string
	for _, w := range ws.Widgets {
		if w.Type == widget.FolderFiles && w.ID == widgetID {
			folder = strings.TrimSpace(widgetdata.Settings(w.Settings).String("folder", ""))
		}
	}
	if folder == "" || isNetworkPath(folder) {
		return errors.New("폴더 위젯을 찾지 못했습니다")
	}
	if !isDocument(name) {
		return fmt.Errorf("%q 는 열 수 없는 파일입니다", name)
	}
	path := filepath.Join(folder, name)
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("파일을 찾지 못했습니다: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%q 는 일반 파일이 아닙니다", name)
	}
	if a.deps.OpenPath == nil {
		return errors.New("파일 열기를 지원하지 않습니다")
	}
	return a.deps.OpenPath(path)
}
