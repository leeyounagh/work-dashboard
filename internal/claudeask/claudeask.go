// Package claudeask runs a one-shot, headless Claude Code request
// (`claude -p`) that may use only the MCP tools it is given and must answer in
// a JSON schema. The dashboard uses it to read Linear and Notion through the
// connectors the user already set up, so it never needs their API tokens.
package claudeask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/launch"
	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// Request is one headless question.
type Request struct {
	Prompt string
	Schema json.RawMessage // JSON schema for structured_output
	// AllowedTools are exact, read-only MCP tool names. Built-in tools are
	// disabled entirely and anything not listed is denied, so content read
	// through a connector cannot make Claude write, delete or run commands.
	AllowedTools    []string
	DisallowedTools []string // a second line of defense (write tools by name)
	Model           string   // default "haiku": cheap and fast enough for lookups
	// NoMCP is for plain questions: no MCP servers or connectors and no
	// user/local settings (so no allow rules of the user's) at all.
	NoMCP bool
}

// maxBudgetUSD caps one lookup's cost.
const maxBudgetUSD = "0.25"

// Answer is the structured result.
type Answer struct {
	Output  json.RawMessage
	CostUSD float64
}

// Runner runs claude with args in dir and returns stdout.
type Runner func(ctx context.Context, dir string, args ...string) ([]byte, error)

// Claude runs the real claude CLI (resolved via exe) without a console window
// and without the parent Claude session markers.
func Claude(exe string) Runner {
	return func(ctx context.Context, dir string, args ...string) ([]byte, error) {
		cmd := procutil.Background(exec.CommandContext(ctx, exe, args...))
		cmd.Dir = dir
		cmd.Env = launch.CleanEnv(os.Environ())
		cmd.WaitDelay = procutil.WaitDelay
		out, err := cmd.Output()
		if err != nil && len(out) == 0 {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				return nil, fmt.Errorf("claude: %s", strings.TrimSpace(string(exitErr.Stderr)))
			}
			return nil, fmt.Errorf("claude 를 실행하지 못했습니다: %w", err)
		}
		return out, nil
	}
}

// Args builds the claude command line for a request.
func Args(r Request) []string {
	model := r.Model
	if model == "" {
		model = "haiku"
	}
	args := []string{
		"-p",
		"--model", model,
		"--output-format", "json",
		"--json-schema", string(r.Schema),
		"--no-session-persistence",
		"--tools", "", // no Bash/Read/Write/...: only the allowed MCP tools exist
		// Not prompting; tools not allowed here are denied. The user's own allow
		// rules still apply, so connector lookups also pass DisallowedTools.
		"--permission-mode", "dontAsk",
		"--max-budget-usd", maxBudgetUSD,
	}
	if r.NoMCP {
		// Connector lookups need user settings (claude.ai connectors did not
		// load without them when started from the desktop), questions do not.
		args = append(args, "--setting-sources", "project", "--strict-mcp-config")
	}
	if len(r.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(r.AllowedTools, ","))
	}
	if len(r.DisallowedTools) > 0 {
		args = append(args, "--disallowedTools", strings.Join(r.DisallowedTools, ","))
	}
	return append(args, "--", r.Prompt)
}

type cliResult struct {
	IsError           bool            `json:"is_error"`
	Result            string          `json:"result"`
	Subtype           string          `json:"subtype"`
	StructuredOutput  json.RawMessage `json:"structured_output"`
	TotalCostUSD      float64         `json:"total_cost_usd"`
	PermissionDenials []struct {
		ToolName string `json:"tool_name"`
	} `json:"permission_denials"`
}

// Ask runs the request in dir (a scratch directory, so no project settings apply).
func Ask(ctx context.Context, run Runner, dir string, r Request) (Answer, error) {
	if !json.Valid(r.Schema) {
		return Answer{}, errors.New("invalid JSON schema")
	}
	out, err := run(ctx, dir, Args(r)...)
	if err != nil {
		return Answer{}, err
	}
	var res cliResult
	if err := json.Unmarshal(out, &res); err != nil {
		return Answer{}, fmt.Errorf("claude 응답을 해석하지 못했습니다: %w", err)
	}
	if res.IsError {
		msg := res.Result
		if msg == "" {
			msg = res.Subtype
		}
		return Answer{CostUSD: res.TotalCostUSD}, fmt.Errorf("claude: %s", msg)
	}
	// Any denied tool call (e.g. an attempted write) makes the answer untrustworthy.
	if len(res.PermissionDenials) > 0 {
		names := make([]string, 0, len(res.PermissionDenials))
		for _, d := range res.PermissionDenials {
			names = append(names, d.ToolName)
		}
		return Answer{CostUSD: res.TotalCostUSD}, fmt.Errorf("claude 가 허용되지 않은 도구를 쓰려 했습니다(%s). 커넥터 연결과 내용을 확인하세요", strings.Join(names, ", "))
	}
	if len(res.StructuredOutput) == 0 || string(res.StructuredOutput) == "null" {
		return Answer{CostUSD: res.TotalCostUSD}, errors.New("claude 가 정해진 형식으로 답하지 않았습니다")
	}
	return Answer{Output: res.StructuredOutput, CostUSD: res.TotalCostUSD}, nil
}
