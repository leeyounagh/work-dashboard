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
	Prompt       string
	Schema       json.RawMessage // JSON schema for structured_output
	AllowedTools []string        // e.g. "mcp__linear" (a whole server) — nothing else is allowed
	Model        string          // default "haiku": cheap and fast enough for lookups
}

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
	}
	if len(r.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(r.AllowedTools, ","))
	}
	return append(args, "--", r.Prompt)
}

type cliResult struct {
	IsError           bool            `json:"is_error"`
	Result            string          `json:"result"`
	Subtype           string          `json:"subtype"`
	StructuredOutput  json.RawMessage `json:"structured_output"`
	TotalCostUSD      float64         `json:"total_cost_usd"`
	PermissionDenials []any           `json:"permission_denials"`
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
	if len(res.StructuredOutput) == 0 || string(res.StructuredOutput) == "null" {
		if len(res.PermissionDenials) > 0 {
			return Answer{CostUSD: res.TotalCostUSD}, errors.New("claude 가 필요한 도구를 쓰지 못했습니다(커넥터 연결을 확인하세요)")
		}
		return Answer{CostUSD: res.TotalCostUSD}, errors.New("claude 가 정해진 형식으로 답하지 않았습니다")
	}
	return Answer{Output: res.StructuredOutput, CostUSD: res.TotalCostUSD}, nil
}
