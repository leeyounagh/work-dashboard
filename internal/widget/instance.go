package widget

import (
	"fmt"
	"maps"
	"slices"
)

// Instance is a widget placed in a workspace. Settings holds only the values
// the user overrode; missing keys fall back to the definition defaults.
type Instance struct {
	Type     string         `json:"type"`
	Enabled  bool           `json:"enabled"`
	Settings map[string]any `json:"settings,omitempty"`
}

// NewInstance creates an enabled instance with no overrides, so it follows
// the catalog defaults even if they change in a later release.
func NewInstance(id string) (Instance, error) {
	if _, ok := find(id); !ok {
		return Instance{}, fmt.Errorf("unknown widget %q", id)
	}
	return Instance{Type: id, Enabled: true, Settings: map[string]any{}}, nil
}

// Validate checks the instance against its catalog definition.
func (i Instance) Validate() error {
	def, ok := find(i.Type)
	if !ok {
		return fmt.Errorf("unknown widget %q", i.Type)
	}
	// Sorted so the reported error is deterministic.
	for _, key := range slices.Sorted(maps.Keys(i.Settings)) {
		idx := slices.IndexFunc(def.Settings, func(s SettingSpec) bool { return s.Key == key })
		if idx < 0 {
			return fmt.Errorf("%s: unknown setting %q", i.Type, key)
		}
		if err := def.Settings[idx].validate(i.Settings[key]); err != nil {
			return fmt.Errorf("%s.%s: %w", i.Type, key, err)
		}
	}
	return nil
}

// ResolvedSettings returns defaults merged with the instance overrides.
// The result shares no slices with the instance or the catalog.
func (i Instance) ResolvedSettings() (map[string]any, error) {
	if err := i.Validate(); err != nil {
		return nil, err
	}
	def, _ := find(i.Type)
	out := make(map[string]any, len(def.Settings))
	for _, s := range def.Settings {
		out[s.Key] = cloneValue(s.Default)
	}
	for k, v := range i.Settings {
		out[k] = cloneValue(v)
	}
	return out, nil
}
