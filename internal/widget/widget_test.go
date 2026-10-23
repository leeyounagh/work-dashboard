package widget

import (
	"strings"
	"testing"
)

func TestCatalogIsWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, def := range Catalog() {
		if def.ID == "" || def.Name == "" || def.Description == "" {
			t.Errorf("definition %+v is missing id/name/description", def)
		}
		if seen[def.ID] {
			t.Errorf("duplicate widget id %q", def.ID)
		}
		seen[def.ID] = true

		keys := map[string]bool{}
		for _, s := range def.Settings {
			if keys[s.Key] {
				t.Errorf("%s: duplicate setting key %q", def.ID, s.Key)
			}
			keys[s.Key] = true
			if err := s.validate(s.Default); err != nil {
				t.Errorf("%s.%s: default value is invalid: %v", def.ID, s.Key, err)
			}
		}
	}
}

func TestCatalogReturnsDeepCopy(t *testing.T) {
	first := Catalog()
	first[0].Name = "mutated"
	for i := range first {
		for j := range first[i].Settings {
			s := &first[i].Settings[j]
			for k := range s.Options {
				s.Options[k] = "HACK"
			}
			if list, ok := s.Default.([]string); ok {
				s.Default = append(list[:0:0], "HACK")
			}
		}
	}
	if Catalog()[0].Name == "mutated" {
		t.Fatal("Catalog must return a copy, not the shared slice")
	}
	if err := (Instance{Type: CIFailures, Settings: map[string]any{"scope": "mine"}}).Validate(); err != nil {
		t.Fatalf("mutating a Catalog() result changed validation: %v", err)
	}
}

func TestStringListAcceptsNil(t *testing.T) {
	// JSON null and Go nil slices both mean "empty list".
	for _, v := range []any{nil, []string(nil)} {
		inst := Instance{Type: PRReviews, Settings: map[string]any{"repos": v}}
		if err := inst.Validate(); err != nil {
			t.Errorf("repos=%#v: %v", v, err)
		}
	}
}

func TestToIntRejectsHugeFloat(t *testing.T) {
	inst := Instance{Type: ClaudeUsage, Settings: map[string]any{"alertPercent": 1e300}}
	if err := inst.Validate(); err == nil {
		t.Fatal("expected error for out-of-range float")
	}
}

func TestLookup(t *testing.T) {
	if _, ok := Lookup(PRReviews); !ok {
		t.Fatalf("expected %q in catalog", PRReviews)
	}
	if _, ok := Lookup("nope"); ok {
		t.Fatal("unknown id must not be found")
	}
}

func TestNewInstanceStoresNoOverrides(t *testing.T) {
	inst, err := NewInstance(ClaudeUsage)
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled {
		t.Error("new instance should be enabled")
	}
	// Defaults are not frozen into the instance, so changing a default later reaches old workspaces.
	if len(inst.Settings) != 0 {
		t.Errorf("Settings = %v, want no overrides", inst.Settings)
	}
	resolved, err := inst.ResolvedSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got := resolved["alertPercent"]; got != 90 {
		t.Errorf("alertPercent default = %v, want 90", got)
	}
	if _, err := NewInstance("nope"); err == nil {
		t.Error("expected error for unknown widget")
	}
}

func TestValidateInstance(t *testing.T) {
	tests := []struct {
		name    string
		inst    Instance
		wantErr string
	}{
		{
			name: "valid with no settings uses defaults",
			inst: Instance{Type: PRReviews, Enabled: true},
		},
		{
			name: "valid reviewer filter",
			inst: Instance{Type: PRReviews, Settings: map[string]any{
				"reviewers":    []any{"alice", "bob"},
				"minApprovals": float64(2), // JSON numbers decode as float64
				"scope":        "mine",
			}},
		},
		{
			name:    "unknown widget type",
			inst:    Instance{Type: "nope"},
			wantErr: "unknown widget",
		},
		{
			name:    "unknown setting key",
			inst:    Instance{Type: PRReviews, Settings: map[string]any{"color": "red"}},
			wantErr: "unknown setting",
		},
		{
			name:    "int out of range",
			inst:    Instance{Type: ClaudeUsage, Settings: map[string]any{"alertPercent": 150}},
			wantErr: "out of range",
		},
		{
			name:    "non-integer number",
			inst:    Instance{Type: ClaudeUsage, Settings: map[string]any{"alertPercent": 90.5}},
			wantErr: "integer",
		},
		{
			name:    "enum not in options",
			inst:    Instance{Type: CIFailures, Settings: map[string]any{"scope": "everyone"}},
			wantErr: "not one of",
		},
		{
			name:    "wrong type for bool",
			inst:    Instance{Type: PRReviews, Settings: map[string]any{"highlightNoReview": "yes"}},
			wantErr: "bool",
		},
		{
			name:    "string list with non-string",
			inst:    Instance{Type: PRReviews, Settings: map[string]any{"reviewers": []any{"a", 1}}},
			wantErr: "list of strings",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.inst.Validate()
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

func TestResolvedSettingsMergesDefaults(t *testing.T) {
	inst := Instance{Type: PRReviews, Settings: map[string]any{"scope": "mine"}}
	got, err := inst.ResolvedSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got["scope"] != "mine" {
		t.Errorf("scope = %v, want override", got["scope"])
	}
	if got["highlightNoReview"] != true {
		t.Errorf("highlightNoReview = %v, want default true", got["highlightNoReview"])
	}
	if len(inst.Settings) != 1 {
		t.Error("ResolvedSettings must not mutate the instance")
	}
}

func TestResolvedSettingsDoesNotShareSlices(t *testing.T) {
	inst := Instance{Type: PRReviews, Settings: map[string]any{"reviewers": []any{"alice"}}}
	got, err := inst.ResolvedSettings()
	if err != nil {
		t.Fatal(err)
	}
	got["reviewers"].([]any)[0] = "mallory"
	if inst.Settings["reviewers"].([]any)[0] != "alice" {
		t.Fatal("ResolvedSettings result shares a slice with the instance")
	}
}

func TestCustomWidgetsAllowSeveralInstances(t *testing.T) {
	def, ok := Lookup(Command)
	if !ok || !def.Multiple {
		t.Fatalf("command widget = %+v", def)
	}
	if d, _ := Lookup(PRReviews); d.Multiple {
		t.Fatal("built-in data widgets stay single")
	}
	inst := Instance{Type: Command, ID: "command-1a2b", Title: "빌드 상태", Enabled: true, Settings: map[string]any{"command": "go version"}}
	if err := inst.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []Instance{
		{Type: Command},             // multiple types need an id
		{Type: Command, ID: "../x"}, // id must be safe
		{Type: Command, ID: "c1", Title: string(make([]rune, 61))}, // title too long
	} {
		if err := bad.Validate(); err == nil {
			t.Errorf("%+v should be rejected", bad)
		}
	}
	if (Instance{Type: Command, ID: "c1"}).Key() != "c1" || (Instance{Type: PRReviews}).Key() != PRReviews {
		t.Fatal("Key")
	}
}
