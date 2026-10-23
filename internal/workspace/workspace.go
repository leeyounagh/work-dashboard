// Package workspace models a named group of folders plus the widgets shown
// for it, and persists them as JSON files outside the repository.
package workspace

import (
	"fmt"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/widget"
)

// idPattern keeps IDs safe to use as file names.
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// reservedID matches Windows device names, which cannot be used as file names.
var reservedID = regexp.MustCompile(`^(con|prn|aux|nul|com[0-9]|lpt[0-9])$`)

// Workspace groups folders that Claude should see together (claude --add-dir)
// with the widgets the user wants for that work.
type Workspace struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Folders []string          `json:"folders"`
	Widgets []widget.Instance `json:"widgets"`
	Notes   string            `json:"notes,omitempty"`
}

// Validate checks the workspace and every widget instance in it.
func (w Workspace) Validate() error {
	if err := checkID(w.ID); err != nil {
		return fmt.Errorf("%w: use lowercase letters, digits and dashes", err)
	}
	if strings.TrimSpace(w.Name) == "" {
		return fmt.Errorf("workspace %s: name is required", w.ID)
	}
	seen := make(map[string]bool, len(w.Folders))
	for _, folder := range w.Folders {
		if !filepath.IsAbs(folder) {
			return fmt.Errorf("workspace %s: folder %q must be an absolute path", w.ID, folder)
		}
		// Network and device paths would make Windows contact another host
		// (leaking NTLM credentials) when a terminal starts there.
		if strings.HasPrefix(folder, `\\`) || strings.HasPrefix(folder, "//") {
			return fmt.Errorf("workspace %s: folder %q must be a local path", w.ID, folder)
		}
		key := folderKey(folder)
		if seen[key] {
			return fmt.Errorf("workspace %s: duplicate folder %q", w.ID, folder)
		}
		seen[key] = true
	}
	keys := make(map[string]bool, len(w.Widgets))
	for i, inst := range w.Widgets {
		if err := inst.Validate(); err != nil {
			return fmt.Errorf("workspace %s: widget #%d: %w", w.ID, i, err)
		}
		if keys[inst.Key()] {
			return fmt.Errorf("workspace %s: widget %q appears twice", w.ID, inst.Key())
		}
		keys[inst.Key()] = true
	}
	return nil
}

// WithWidgetEnabled returns a copy with the widget at index turned on or off.
func (w Workspace) WithWidgetEnabled(index int, enabled bool) (Workspace, error) {
	if index < 0 || index >= len(w.Widgets) {
		return Workspace{}, fmt.Errorf("widget index %d out of range", index)
	}
	out := w
	out.Widgets = slices.Clone(w.Widgets)
	out.Widgets[index].Enabled = enabled
	return out, nil
}

// folderKey normalises a folder for duplicate detection. Windows and macOS
// file systems are case-insensitive by default; Linux is not.
func folderKey(folder string) string {
	key := filepath.Clean(folder)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		key = strings.ToLower(key)
	}
	return key
}
