package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/leeyounagh/work-dashboard/internal/claudeask"
	"github.com/leeyounagh/work-dashboard/internal/command"
	"github.com/leeyounagh/work-dashboard/internal/gitinfo"
	"github.com/leeyounagh/work-dashboard/internal/sessions"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// askCacheFor keeps connector lookups (which cost Claude usage) to one per half hour.
const askCacheFor = 30 * time.Minute

// sessionStore is the part of the sessions store the app needs.
type sessionStore interface {
	Started(r sessions.Record) error
	Touch(id, prompt string, at time.Time) error
	Closed(id string) error
	Get(id string) (sessions.Record, bool, error)
	Recent(workspaceID string, n int) ([]sessions.Record, error)
}

type askEntry struct {
	data any
	at   time.Time
}

type askCache struct {
	mu      sync.Mutex
	entries map[string]askEntry
	flight  singleflight.Group
}

// PlannedData marks a widget whose data source is not wired up yet.
type PlannedData struct {
	Planned bool   `json:"planned"`
	Message string `json:"message"`
}

// WorktreeItem is a worktree with the widget's verdict.
type WorktreeItem struct {
	gitinfo.Worktree
	Stale bool `json:"stale"`
}

// WorktreesData feeds the worktree widget.
type WorktreesData struct {
	BaseRef string         `json:"baseRef"`
	Items   []WorktreeItem `json:"items"`
	Errors  []string       `json:"errors"`
}

// LinearIssue is one issue as reported by Claude through the Linear connector.
type LinearIssue struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Team      string `json:"team"`
	URL       string `json:"url"`
	Priority  string `json:"priority"`
	UpdatedAt string `json:"updatedAt"`
}

// LinearData feeds the Linear widget.
type LinearData struct {
	Issues    []LinearIssue `json:"issues"`
	FetchedAt time.Time     `json:"fetchedAt"`
	CostUSD   float64       `json:"costUsd"`
}

// NotionPage is one spec page.
type NotionPage struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Version    string `json:"version"`
	LastEdited string `json:"lastEdited"`
}

// NotionData feeds the Notion widget.
type NotionData struct {
	Pages     []NotionPage `json:"pages"`
	FetchedAt time.Time    `json:"fetchedAt"`
	CostUSD   float64      `json:"costUsd"`
}

// QAReport is a QA output file.
type QAReport struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Modified time.Time `json:"modified"`
}

// QAData feeds the qa-2pass widget.
type QAData struct {
	Domain   string     `json:"domain"`
	Features []string   `json:"features"`
	Modes    []string   `json:"modes"`
	Reports  []QAReport `json:"reports"`
}

// SessionsData feeds the session-restore widget.
type SessionsData struct {
	Recent       []sessions.Record `json:"recent"`
	ResumeClaude bool              `json:"resumeClaude"`
}

// qaModes are the modes qa-2pass understands.
var qaModes = []string{"1차", "2차", "3차", "명세대조"}

// Values copied into Claude prompts must be plain identifiers.
var (
	filterPattern   = regexp.MustCompile(`^[\p{L}\p{N} _.-]{1,40}$`)
	notionIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$`)
)

func checkFilters(kind string, values []string, pattern *regexp.Regexp) error {
	for _, v := range values {
		if !pattern.MatchString(v) {
			return fmt.Errorf("%s 값 %q 는 쓸 수 없습니다", kind, v)
		}
	}
	return nil
}

// buildLocalWidget handles widgets backed by local tools and Claude connectors.
func (a *App) buildLocalWidget(ctx context.Context, ws workspace.Workspace, typ string, s widgetdata.Settings, fresh bool) (any, error) {
	switch typ {
	case widget.Worktrees:
		return a.worktrees(ctx, ws, s)
	case widget.DeploySwap:
		return a.deploy(ctx, ws, s)
	case widget.LinearIssues:
		return a.linear(ctx, s, fresh)
	case widget.NotionSpecs:
		return a.notion(ctx, s, fresh)
	case widget.QA2Pass:
		return a.qa(s)
	case widget.SessionRestore:
		return a.sessionsData(ws, s)
	default:
		return PlannedData{Planned: true, Message: typ + " 위젯은 아직 지원하지 않습니다"}, nil
	}
}

func (a *App) worktrees(ctx context.Context, ws workspace.Workspace, s widgetdata.Settings) (WorktreesData, error) {
	base := s.String("baseRef", "origin/main")
	staleBehind := s.Int("staleBehind", 100)
	d := WorktreesData{BaseRef: base, Items: []WorktreeItem{}, Errors: []string{}}
	seen := map[string]bool{}
	for _, folder := range ws.Folders {
		list, err := gitinfo.Worktrees(ctx, folder, base)
		if err != nil {
			d.Errors = append(d.Errors, fmt.Sprintf("%s: %v", filepath.Base(folder), err))
			continue
		}
		for _, wt := range list {
			key := strings.ToLower(filepath.Clean(wt.Path))
			if seen[key] {
				continue
			}
			seen[key] = true
			d.Items = append(d.Items, WorktreeItem{Worktree: wt, Stale: wt.Behind >= staleBehind})
		}
	}
	sort.SliceStable(d.Items, func(i, j int) bool { return d.Items[i].Behind > d.Items[j].Behind })
	return d, nil
}

func (a *App) deploy(ctx context.Context, ws workspace.Workspace, s widgetdata.Settings) (widgetdata.DeployData, error) {
	line := s.String("command", "")
	if line == "" {
		return widgetdata.DeployData{}, errors.New("위젯 설정에서 배포 상태를 출력하는 명령을 입력하세요 (예: node <deploy-status>/scripts/index.mjs --json)")
	}
	dir, _ := os.UserHomeDir()
	if len(ws.Folders) > 0 {
		dir = ws.Folders[0]
	}
	out, err := command.Run(ctx, dir, line)
	if err != nil {
		return widgetdata.DeployData{}, err
	}
	if ctx.Err() != nil {
		return widgetdata.DeployData{}, errors.New("배포 상태 명령이 시간 안에 끝나지 않았습니다")
	}
	if strings.TrimSpace(out.Stdout) == "" {
		msg := strings.TrimSpace(out.Stderr)
		if msg == "" {
			msg = fmt.Sprintf("종료 코드 %d", out.ExitCode)
		}
		return widgetdata.DeployData{}, fmt.Errorf("배포 상태 명령이 아무것도 출력하지 않았습니다: %s", msg)
	}
	return widgetdata.BuildDeploy(out.Stdout, out.ExitCode, s), nil
}

// cachedAsk runs a connector lookup at most once per askCacheFor per key.
func (a *App) cachedAsk(key string, fresh bool, fetch func() (any, error)) (any, error) {
	a.asks.mu.Lock()
	if a.asks.entries == nil {
		a.asks.entries = map[string]askEntry{}
	}
	e, ok := a.asks.entries[key]
	a.asks.mu.Unlock()
	if ok && !fresh && time.Since(e.at) < askCacheFor {
		return e.data, nil
	}
	v, err, _ := a.asks.flight.Do(key, fetch)
	if err != nil {
		return nil, err
	}
	a.asks.mu.Lock()
	a.asks.entries[key] = askEntry{data: v, at: time.Now()}
	a.asks.mu.Unlock()
	return v, nil
}

func (a *App) ask(ctx context.Context, r claudeask.Request, out any) (float64, error) {
	if a.deps.Ask == nil {
		return 0, errors.New("claude 를 찾지 못했습니다")
	}
	if err := os.MkdirAll(a.deps.RunDir, 0o700); err != nil {
		return 0, err
	}
	ans, err := claudeask.Ask(ctx, a.deps.Ask, a.deps.RunDir, r)
	if ctx.Err() != nil {
		return ans.CostUSD, errors.New("Claude 응답이 시간 안에 오지 않았습니다. 잠시 뒤 새로고침하세요")
	}
	if err != nil {
		return ans.CostUSD, err
	}
	if err := json.Unmarshal(ans.Output, out); err != nil {
		return ans.CostUSD, fmt.Errorf("claude 응답 형식이 맞지 않습니다: %w", err)
	}
	return ans.CostUSD, nil
}

// connectorAvailable lets Claude say the tools were missing, so a missing
// connector shows as an error instead of an empty (normal-looking) list.
var linearSchema = json.RawMessage(`{"type":"object","properties":{"connectorAvailable":{"type":"boolean"},
"issues":{"type":"array","items":{"type":"object",
"properties":{"id":{"type":"string"},"title":{"type":"string"},"state":{"type":"string"},"team":{"type":"string"},
"url":{"type":"string"},"priority":{"type":"string"},"updatedAt":{"type":"string"}},"required":["id","title","state","url"]}}},
"required":["connectorAvailable","issues"]}`)

var errNoConnector = errors.New("Claude 에서 이 커넥터 도구를 찾지 못했습니다. Claude Code 의 MCP/커넥터 연결을 확인하세요")

func (a *App) linear(ctx context.Context, s widgetdata.Settings, fresh bool) (any, error) {
	teams, states := s.Strings("teams"), s.Strings("states")
	if err := checkFilters("팀", teams, filterPattern); err != nil {
		return nil, err
	}
	if err := checkFilters("상태", states, filterPattern); err != nil {
		return nil, err
	}
	prompt := "Using the Linear MCP tools, list issues assigned to me that are not completed or canceled (at most 50)."
	if len(teams) > 0 {
		prompt += " Only teams: " + strings.Join(teams, ", ") + "."
	}
	if len(states) > 0 {
		prompt += " Only states: " + strings.Join(states, ", ") + "."
	}
	prompt += " Return them in the structured output, most recently updated first. Set connectorAvailable to false if no Linear tools are available. Do not change anything in Linear."
	key := "linear:" + strings.Join(teams, ",") + "|" + strings.Join(states, ",")
	return a.cachedAsk(key, fresh, func() (any, error) {
		var out struct {
			ConnectorAvailable bool          `json:"connectorAvailable"`
			Issues             []LinearIssue `json:"issues"`
		}
		cost, err := a.ask(ctx, claudeask.Request{Prompt: prompt, Schema: linearSchema, AllowedTools: []string{"mcp__linear"}}, &out)
		if err != nil {
			return nil, err
		}
		if !out.ConnectorAvailable {
			return nil, errNoConnector
		}
		if out.Issues == nil {
			out.Issues = []LinearIssue{}
		}
		return LinearData{Issues: out.Issues, FetchedAt: time.Now(), CostUSD: cost}, nil
	})
}

var notionSchema = json.RawMessage(`{"type":"object","properties":{"connectorAvailable":{"type":"boolean"},
"pages":{"type":"array","items":{"type":"object",
"properties":{"id":{"type":"string"},"title":{"type":"string"},"url":{"type":"string"},"version":{"type":"string"},
"lastEdited":{"type":"string"}},"required":["id","title"]}}},"required":["connectorAvailable","pages"]}`)

func (a *App) notion(ctx context.Context, s widgetdata.Settings, fresh bool) (any, error) {
	pages := s.Strings("pages")
	if len(pages) == 0 {
		return nil, errors.New("위젯 설정에 Notion 페이지 ID 를 넣으세요")
	}
	if err := checkFilters("페이지 ID", pages, notionIDPattern); err != nil {
		return nil, err
	}
	prompt := "Using the Notion tools, fetch each of these Notion pages: " + strings.Join(pages, ", ") +
		". For each, report its id, title, url, the document version if one is written in the title or near the top " +
		"(e.g. \"Ver 1.2.0\", else empty), and when it was last edited. Return them in the structured output. " +
		"Set connectorAvailable to false if no Notion tools are available. Do not edit anything."
	key := "notion:" + strings.Join(pages, ",")
	return a.cachedAsk(key, fresh, func() (any, error) {
		var out struct {
			ConnectorAvailable bool         `json:"connectorAvailable"`
			Pages              []NotionPage `json:"pages"`
		}
		cost, err := a.ask(ctx, claudeask.Request{Prompt: prompt, Schema: notionSchema, AllowedTools: []string{"mcp__claude_ai_Notion", "mcp__notion"}}, &out)
		if err != nil {
			return nil, err
		}
		if !out.ConnectorAvailable {
			return nil, errNoConnector
		}
		if out.Pages == nil {
			out.Pages = []NotionPage{}
		}
		return NotionData{Pages: out.Pages, FetchedAt: time.Now(), CostUSD: cost}, nil
	})
}

var reportExt = map[string]bool{".md": true, ".html": true, ".pdf": true}

func (a *App) qa(s widgetdata.Settings) (QAData, error) {
	d := QAData{Domain: s.String("domain", ""), Features: s.Strings("features"), Modes: qaModes, Reports: []QAReport{}}
	if d.Features == nil {
		d.Features = []string{}
	}
	dir := s.String("reportsDir", "")
	if dir == "" {
		return d, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return d, fmt.Errorf("QA 보고서 폴더를 읽지 못했습니다: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() || !reportExt[strings.ToLower(filepath.Ext(e.Name()))] {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		d.Reports = append(d.Reports, QAReport{Name: e.Name(), Path: filepath.Join(dir, e.Name()), Modified: info.ModTime()})
	}
	sort.Slice(d.Reports, func(i, j int) bool { return d.Reports[i].Modified.After(d.Reports[j].Modified) })
	if len(d.Reports) > 15 {
		d.Reports = d.Reports[:15]
	}
	return d, nil
}

func (a *App) sessionsData(ws workspace.Workspace, s widgetdata.Settings) (SessionsData, error) {
	d := SessionsData{Recent: []sessions.Record{}, ResumeClaude: s.Bool("resumeClaude", true)}
	if a.deps.Sessions == nil {
		return d, nil
	}
	recent, err := a.deps.Sessions.Recent(ws.ID, 10)
	if err != nil {
		return d, err
	}
	d.Recent = recent
	return d, nil
}
