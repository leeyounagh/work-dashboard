package widget

import (
	"fmt"
	"math"
	"slices"
)

// Kind is the value type a widget setting accepts.
type Kind string

const (
	KindBool       Kind = "bool"
	KindInt        Kind = "int"
	KindString     Kind = "string"
	KindStringList Kind = "stringList"
	KindEnum       Kind = "enum"
)

// SettingSpec describes one configurable value of a widget.
type SettingSpec struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Kind        Kind     `json:"kind"`
	Default     any      `json:"default"`
	Options     []string `json:"options,omitempty"` // KindEnum only
	Min         int      `json:"min"`               // KindInt only; 0 is a meaningful bound, so no omitempty
	Max         int      `json:"max"`               // KindInt only
	Description string   `json:"description,omitempty"`
}

func (s SettingSpec) validate(v any) error {
	switch s.Kind {
	case KindBool:
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("must be a bool, got %T", v)
		}
	case KindInt:
		n, err := toInt(v)
		if err != nil {
			return err
		}
		if n < s.Min || n > s.Max {
			return fmt.Errorf("%d is out of range [%d, %d]", n, s.Min, s.Max)
		}
	case KindString:
		if _, ok := v.(string); !ok {
			return fmt.Errorf("must be a string, got %T", v)
		}
	case KindStringList:
		if !isStringList(v) {
			return fmt.Errorf("must be a list of strings")
		}
	case KindEnum:
		str, ok := v.(string)
		if !ok || !slices.Contains(s.Options, str) {
			return fmt.Errorf("%v is not one of %v", v, s.Options)
		}
	default:
		return fmt.Errorf("unsupported kind %q", s.Kind)
	}
	return nil
}

// toInt accepts Go ints and JSON-decoded float64 values that hold whole numbers.
func toInt(v any) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		if n < math.MinInt32 || n > math.MaxInt32 {
			return 0, fmt.Errorf("%d is out of range", n)
		}
		return int(n), nil
	case float64:
		if n != math.Trunc(n) {
			return 0, fmt.Errorf("must be an integer, got %v", n)
		}
		// Converting a float outside the int range is implementation-defined; reject it first.
		if n < math.MinInt32 || n > math.MaxInt32 {
			return 0, fmt.Errorf("%v is out of range", n)
		}
		return int(n), nil
	default:
		return 0, fmt.Errorf("must be an integer, got %T", v)
	}
}

// isStringList treats nil (JSON null, nil slice) as an empty list so that a
// value accepted by Save also survives the JSON round trip back through List.
func isStringList(v any) bool {
	switch list := v.(type) {
	case nil:
		return true
	case []string:
		return true
	case []any:
		for _, item := range list {
			if _, ok := item.(string); !ok {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// cloneValue copies slice values so callers cannot change shared state.
func cloneValue(v any) any {
	switch list := v.(type) {
	case []string:
		return slices.Clone(list)
	case []any:
		return slices.Clone(list)
	default:
		return v
	}
}

func cloneSpec(s SettingSpec) SettingSpec {
	s.Options = slices.Clone(s.Options)
	s.Default = cloneValue(s.Default)
	return s
}
