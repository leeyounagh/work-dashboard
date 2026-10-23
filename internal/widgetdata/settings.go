// Package widgetdata turns raw data (PRs, worktrees, …) into what each widget
// shows, applying the widget's settings. Everything here is pure.
package widgetdata

// Settings are resolved widget settings (defaults merged with overrides).
// Values may come from Go defaults or from JSON, so numbers can be int or float64.
type Settings map[string]any

func (s Settings) Int(key string, def int) int {
	switch v := s[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	default:
		return def
	}
}

func (s Settings) Bool(key string, def bool) bool {
	if v, ok := s[key].(bool); ok {
		return v
	}
	return def
}

func (s Settings) String(key, def string) string {
	if v, ok := s[key].(string); ok && v != "" {
		return v
	}
	return def
}

// Strings returns a string list, skipping non-string items.
func (s Settings) Strings(key string) []string {
	switch v := s[key].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out
	default:
		return nil
	}
}
