package launch

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
)

// Settings are the user's own launch preferences, kept in
// ~/.work-dashboard/settings.json so they never ship with the app.
type Settings struct {
	// ClaudePermissionMode starts every dashboard Claude session in this
	// mode (claude --permission-mode), e.g. "bypassPermissions".
	ClaudePermissionMode string `json:"claudePermissionMode"`
}

// permissionModes are the values claude --permission-mode accepts (claude 2.1.311).
var permissionModes = []string{"acceptEdits", "auto", "bypassPermissions", "dontAsk", "manual", "plan"}

func validPermissionMode(mode string) bool { return slices.Contains(permissionModes, mode) }

// LoadSettings reads the settings file. A missing file means the defaults;
// a broken one returns the defaults with an error to log.
func LoadSettings(path string) (Settings, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("설정 파일을 읽지 못했습니다: %w", err)
	}
	// PowerShell 5.1 writes UTF-8 with a BOM.
	data = bytes.TrimPrefix(data, []byte("ï»¿"))
	var s Settings
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields() // a misspelled key must not silently do nothing
	if err := dec.Decode(&s); err != nil {
		return Settings{}, fmt.Errorf("설정 파일 %s 형식이 올바르지 않습니다: %w", path, err)
	}
	if s.ClaudePermissionMode != "" && !validPermissionMode(s.ClaudePermissionMode) {
		return Settings{}, fmt.Errorf("claudePermissionMode %q 는 지원하지 않는 값입니다 (%v)", s.ClaudePermissionMode, permissionModes)
	}
	return s, nil
}
