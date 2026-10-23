package claudeask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var schema = json.RawMessage(`{"type":"object","properties":{"issues":{"type":"array"}}}`)

func fake(out string, err error, got *[]string, gotDir *string) Runner {
	return func(_ context.Context, dir string, args ...string) ([]byte, error) {
		*got = args
		*gotDir = dir
		return []byte(out), err
	}
}

func TestArgs(t *testing.T) {
	args := Args(Request{
		Prompt: "-list my issues", Schema: schema,
		AllowedTools:    []string{"mcp__linear__list_issues", "mcp__linear__get_user"},
		DisallowedTools: []string{"mcp__linear__save_issue"},
	})
	want := []string{
		"-p", "--model", "haiku", "--output-format", "json", "--json-schema", string(schema),
		"--no-session-persistence",
		// No built-in tools (Bash, Read, ...), and anything not allowed is denied
		// instead of prompting, whatever the user's own allow rules say.
		"--tools", "", "--permission-mode", "dontAsk", "--max-budget-usd", "0.25",
		"--allowedTools", "mcp__linear__list_issues,mcp__linear__get_user",
		"--disallowedTools", "mcp__linear__save_issue",
		"--", "-list my issues",
	}
	if !slices.Equal(args, want) {
		t.Fatalf("Args = %q\nwant  %q", args, want)
	}
	if got := Args(Request{Prompt: "p", Schema: schema, Model: "sonnet"}); got[2] != "sonnet" || slices.Contains(got, "--allowedTools") {
		t.Fatalf("Args = %q", got)
	}
}

func TestAsk(t *testing.T) {
	var args []string
	var dir string
	out := `{"type":"result","is_error":false,"result":"ok","structured_output":{"issues":[{"id":"GRO-1"}]},"total_cost_usd":0.0176}`
	ans, err := Ask(context.Background(), fake(out, nil, &args, &dir), "C:\\run", Request{Prompt: "p", Schema: schema})
	if err != nil {
		t.Fatal(err)
	}
	if dir != "C:\\run" || !strings.Contains(string(ans.Output), "GRO-1") || ans.CostUSD != 0.0176 {
		t.Fatalf("ans = %+v dir = %q", ans, dir)
	}
}

func TestAskErrors(t *testing.T) {
	var args []string
	var dir string
	tests := map[string]struct {
		out     string
		err     error
		schema  json.RawMessage
		wantErr string
	}{
		"runner":        {err: errors.New("claude: not logged in"), schema: schema, wantErr: "not logged in"},
		"bad json":      {out: "nope", schema: schema, wantErr: "해석"},
		"is_error":      {out: `{"is_error":true,"result":"rate limited"}`, schema: schema, wantErr: "rate limited"},
		"no structured": {out: `{"is_error":false,"structured_output":null}`, schema: schema, wantErr: "형식"},
		"denied":        {out: `{"is_error":false,"permission_denials":[{"tool_name":"x"}]}`, schema: schema, wantErr: "커넥터"},
		// A denied tool call makes any answer untrustworthy, even a structured one.
		"denied with output": {out: `{"is_error":false,"structured_output":{"issues":[]},"permission_denials":[{"tool_name":"mcp__linear__save_issue"}]}`, schema: schema, wantErr: "save_issue"},
		"bad schema":         {schema: json.RawMessage(`{`), wantErr: "schema"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := Ask(context.Background(), fake(tt.out, tt.err, &args, &dir), "d", Request{Prompt: "p", Schema: tt.schema})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestHelperProcess is not a real test: it stands in for the claude CLI.
func TestHelperProcess(t *testing.T) {
	switch os.Getenv("CLAUDEASK_HELPER") {
	case "":
		return
	case "ok":
		fmt.Print(`{"is_error":false,"structured_output":{"args":` + strconv.Itoa(len(os.Args)) + `}}`)
	case "fail":
		fmt.Fprint(os.Stderr, "not logged in")
		os.Exit(1)
	}
	os.Exit(0)
}

func TestClaudeRunner(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	run := func(mode string) ([]byte, error) {
		t.Setenv("CLAUDEASK_HELPER", mode)
		return Claude(exe)(context.Background(), t.TempDir(), "-test.run=TestHelperProcess", "--")
	}
	out, err := run("ok")
	if err != nil || !strings.Contains(string(out), `"structured_output"`) {
		t.Fatalf("out = %s, err = %v", out, err)
	}
	if _, err := run("fail"); err == nil || !strings.Contains(err.Error(), "not logged in") {
		t.Fatalf("err = %v", err)
	}
	if _, err := Claude("definitely-missing-claude-xyz")(context.Background(), t.TempDir()); err == nil {
		t.Fatal("missing executable must fail")
	}
}
