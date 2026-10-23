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

// askCacheFor keeps connector lookups (which cost Claude usage) to one per
// half hour; failures are kept for askErrorFor so auto refresh does not pay
// for the same failure every few minutes. An explicit refresh always retries.
const (
	askCacheFor = 30 * time.Minute
	askErrorFor = 10 * time.Minute
)

// Exact read-only tools for connector lookups (see claudeask.Request).
var (
	linearReadTools = []string{
		"mcp__linear__list_issues", "mcp__linear__get_issue", "mcp__linear__list_teams",
		"mcp__linear__list_issue_statuses", "mcp__linear__get_user",
	}
	linearInboxTools = []string{"mcp__linear__get_notifications", "mcp__linear__get_issue", "mcp__linear__get_user"}
	linearWriteTools = []string{
		"mcp__linear__save_issue", "mcp__linear__save_comment", "mcp__linear__delete_comment",
		"mcp__linear__create_attachment", "mcp__linear__delete_attachment", "mcp__linear__share_issue",
		"mcp__linear__save_project", "mcp__linear__save_document", "mcp__linear__merge_diff",
		"mcp__linear__mark_notification",
	}
	notionReadTools  = []string{"mcp__claude_ai_Notion__notion-fetch"}
	notionWriteTools = []string{
		"mcp__claude_ai_Notion__notion-update-page", "mcp__claude_ai_Notion__notion-create-pages",
		"mcp__claude_ai_Notion__notion-move-pages", "mcp__claude_ai_Notion__notion-duplicate-page",
		"mcp__claude_ai_Notion__notion-delete-pages", "mcp__claude_ai_Notion__notion-create-comment",
	}
)

// Links reported by Claude are only kept when they point at the service.
var (
	linearURL = regexp.MustCompile(`^https://linear\.app/`)
	notionURL = regexp.MustCompile(`^https://(www\.)?notion\.(so|site)/`)
)

// sessionStore is the part of the sessions store the app needs.
type sessionStore interface {
	Started(r sessions.Record) error
	Touch(id, prompt string, at time.Time) error
	Closed(id string) error
	Get(id string) (sessions.Record, bool, error)
	Rename(id, title string) error
	Recent(workspaceID string, n int) ([]sessions.Record, error)
}

type askEntry struct {
	data any
	err  error
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
	case widget.LinearInbox:
		return a.linearInbox(ctx, s, fresh)
	case widget.NotionSpecs:
		return a.notion(ctx, s, fresh)
	case widget.QA2Pass:
		return a.qa(s)
	case widget.SessionRestore:
		return a.sessionsData(ws, s)
	case widget.Command:
		return a.commandWidget(ctx, ws, s)
	case widget.Links:
		return linksWidget(s), nil
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
	d := widgetdata.BuildDeploy(out.Stdout, out.ExitCode, s)
	d.Truncated = out.Truncated
	return d, nil
}

// cachedAsk runs a connector lookup at most once per askCacheFor per key.
func (a *App) cachedAsk(key string, fresh bool, fetch func() (any, error)) (any, error) {
	a.asks.mu.Lock()
	if a.asks.entries == nil {
		a.asks.entries = map[string]askEntry{}
	}
	e, ok := a.asks.entries[key]
	a.asks.mu.Unlock()
	if ok && !fresh {
		if e.err == nil && time.Since(e.at) < askCacheFor {
			return e.data, nil
		}
		if e.err != nil && time.Since(e.at) < askErrorFor {
			return nil, e.err
		}
	}
	v, err, _ := a.asks.flight.Do(key, fetch)
	a.asks.mu.Lock()
	a.asks.entries[key] = askEntry{data: v, err: err, at: time.Now()}
	for k, old := range a.asks.entries {
		if time.Since(old.at) > askCacheFor {
			delete(a.asks.entries, k)
		}
	}
	a.asks.mu.Unlock()
	return v, err
}

func (a *App) ask(ctx context.Context, r claudeask.Request, out any) (float64, error) {
	if a.deps.Ask == nil {
		return 0, errors.New("claude 를 찾지 못했습니다")
	}
	// A separate empty folder: never the run dir that holds the bridge tokens.
	dir := filepath.Join(filepath.Dir(a.deps.RunDir), "ask")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return 0, err
	}
	ans, err := claudeask.Ask(ctx, a.deps.Ask, dir, r)
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
		cost, err := a.ask(ctx, claudeask.Request{Prompt: prompt, Schema: linearSchema, AllowedTools: linearReadTools, DisallowedTools: linearWriteTools}, &out)
		if err != nil {
			return nil, err
		}
		if !out.ConnectorAvailable {
			return nil, errNoConnector
		}
		for i := range out.Issues {
			if !linearURL.MatchString(out.Issues[i].URL) {
				out.Issues[i].URL = ""
			}
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
		cost, err := a.ask(ctx, claudeask.Request{Prompt: prompt, Schema: notionSchema, AllowedTools: notionReadTools, DisallowedTools: notionWriteTools}, &out)
		if err != nil {
			return nil, err
		}
		if !out.ConnectorAvailable {
			return nil, errNoConnector
		}
		for i := range out.Pages {
			if !notionURL.MatchString(out.Pages[i].URL) {
				out.Pages[i].URL = ""
			}
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
	if recent != nil {
		d.Recent = recent
	}
	return d, nil
}

// CommandData feeds the command output widget.
type CommandData struct {
	Text      string `json:"text"`
	ExitCode  int    `json:"exitCode"`
	Truncated bool   `json:"truncated"`
}

// lastLines keeps the end of a command's output, where results usually are.
func lastLines(text string, n int) string {
	lines := strings.Split(strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func (a *App) commandWidget(ctx context.Context, ws workspace.Workspace, s widgetdata.Settings) (CommandData, error) {
	line := s.String("command", "")
	if line == "" {
		return CommandData{}, errors.New("설정에서 실행할 명령을 입력하세요")
	}
	dir, _ := os.UserHomeDir()
	if len(ws.Folders) > 0 {
		dir = ws.Folders[0]
	}
	out, err := command.Run(ctx, dir, line)
	if err != nil {
		return CommandData{}, err
	}
	text := out.Stdout
	if strings.TrimSpace(text) == "" {
		text = out.Stderr
	}
	return CommandData{Text: lastLines(text, s.Int("lines", 40)), ExitCode: out.ExitCode, Truncated: out.Truncated}, nil
}

// Link is one entry of the links widget.
type Link struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// LinksData feeds the links widget.
type LinksData struct {
	Links   []Link   `json:"links"`
	Invalid []string `json:"invalid"` // entries that are not name=http(s) URL
}

func linksWidget(s widgetdata.Settings) LinksData {
	d := LinksData{Links: []Link{}, Invalid: []string{}}
	for _, item := range s.Strings("links") {
		name, url, ok := strings.Cut(item, "=")
		name, url = strings.TrimSpace(name), strings.TrimSpace(url)
		if !ok || name == "" || !(strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://")) {
			d.Invalid = append(d.Invalid, item)
			continue
		}
		d.Links = append(d.Links, Link{Name: name, URL: url})
	}
	return d
}

// LinearNotification is one inbox entry reported through the Linear connector.
type LinearNotification struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"` // mention, assigned, comment, status, ...
	Title     string `json:"title"`
	Actor     string `json:"actor"`
	CreatedAt string `json:"createdAt"`
	Read      bool   `json:"read"`
	URL       string `json:"url"`
}

// LinearInboxData feeds the Linear notifications widget.
type LinearInboxData struct {
	Notifications []LinearNotification `json:"notifications"`
	Unread        int                  `json:"unread"`
	FetchedAt     time.Time            `json:"fetchedAt"`
	CostUSD       float64              `json:"costUsd"`
}

var linearInboxSchema = json.RawMessage(`{"type":"object","properties":{"connectorAvailable":{"type":"boolean"},
"notifications":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"kind":{"type":"string"},
"title":{"type":"string"},"actor":{"type":"string"},"createdAt":{"type":"string"},"read":{"type":"boolean"},
"url":{"type":"string"}},"required":["id","title"]}}},"required":["connectorAvailable","notifications"]}`)

func (a *App) linearInbox(ctx context.Context, s widgetdata.Settings, fresh bool) (any, error) {
	unreadOnly := s.Bool("unreadOnly", true)
	prompt := "Using the Linear MCP tools, list my most recent Linear notifications (at most 30), newest first."
	if unreadOnly {
		prompt += " Include only unread notifications."
	}
	prompt += " For each give id, kind (mention, assigned, comment, status, review, other), a short title naming the issue," +
		" the actor, createdAt, whether it is read, and the issue url. Set connectorAvailable to false if no Linear tools" +
		" are available. Do not mark anything as read and do not change anything in Linear."
	key := fmt.Sprintf("linear-inbox:%v", unreadOnly)
	return a.cachedAsk(key, fresh, func() (any, error) {
		var out struct {
			ConnectorAvailable bool                 `json:"connectorAvailable"`
			Notifications      []LinearNotification `json:"notifications"`
		}
		cost, err := a.ask(ctx, claudeask.Request{Prompt: prompt, Schema: linearInboxSchema, AllowedTools: linearInboxTools, DisallowedTools: linearWriteTools}, &out)
		if err != nil {
			return nil, err
		}
		if !out.ConnectorAvailable {
			return nil, errNoConnector
		}
		d := LinearInboxData{Notifications: []LinearNotification{}, FetchedAt: time.Now(), CostUSD: cost}
		for _, n := range out.Notifications {
			if !linearURL.MatchString(n.URL) {
				n.URL = ""
			}
			if !n.Read {
				d.Unread++
			}
			d.Notifications = append(d.Notifications, n)
		}
		return d, nil
	})
}
