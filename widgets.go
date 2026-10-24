package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/leeyounagh/work-dashboard/internal/claudeacct"
	"github.com/leeyounagh/work-dashboard/internal/github"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// prCacheFor keeps gh from running on every widget refresh.
const prCacheFor = 90 * time.Second

// claudeAccount is the part of claudeacct the widgets need.
type claudeAccount interface {
	Login() (claudeacct.Login, error)
	Usage(ctx context.Context) (claudeacct.Usage, error)
}

// WidgetResult is one widget's data for the UI.
type WidgetResult struct {
	Type      string    `json:"type"`
	Data      any       `json:"data,omitempty"`
	Error     string    `json:"error,omitempty"`
	Setup     string    `json:"setup,omitempty"` // what to set up before it can show anything
	FetchedAt time.Time `json:"fetchedAt"`
}

// ClaudeUsageData feeds the Claude usage & login widget.
type ClaudeUsageData struct {
	Login        claudeacct.Login `json:"login"`
	Usage        claudeacct.Usage `json:"usage"`
	UsageError   string           `json:"usageError,omitempty"`
	AlertPercent int              `json:"alertPercent"`
	Alert        bool             `json:"alert"` // some window is at or above AlertPercent
}

type prCacheEntry struct {
	prs []github.PR
	at  time.Time
}

type prCache struct {
	mu      sync.Mutex
	entries map[string]prCacheEntry
	flight  singleflight.Group // one gh run per query at a time
}

func (a *App) now() time.Time {
	if a.deps.Now != nil {
		return a.deps.Now()
	}
	return time.Now()
}

// searchPRs runs (or reuses) a GitHub search.
func (a *App) searchPRs(ctx context.Context, query string, fresh bool) ([]github.PR, error) {
	a.prs.mu.Lock()
	if a.prs.entries == nil {
		a.prs.entries = map[string]prCacheEntry{}
	}
	e, ok := a.prs.entries[query]
	a.prs.mu.Unlock()
	if ok && !fresh && time.Since(e.at) < prCacheFor {
		return e.prs, nil
	}
	started := time.Now()
	v, err, _ := a.prs.flight.Do(query, func() (any, error) {
		return github.Search(ctx, a.deps.GitHub, query)
	})
	if err != nil {
		return nil, err
	}
	prs := v.([]github.PR)
	a.prs.mu.Lock()
	// Keep a newer result that finished while this one ran; drop expired entries.
	if cur, ok := a.prs.entries[query]; !ok || cur.at.Before(started) {
		a.prs.entries[query] = prCacheEntry{prs: prs, at: started}
	}
	for q, e := range a.prs.entries {
		if time.Since(e.at) > prCacheFor {
			delete(a.prs.entries, q)
		}
	}
	a.prs.mu.Unlock()
	return prs, nil
}

// prsFor runs the searches for a scope and merges them without duplicates.
func (a *App) prsFor(ctx context.Context, scope string, repos []string, fresh bool) ([]github.PR, error) {
	var bases []string
	switch scope {
	case "review-requested":
		bases = []string{"review-requested:@me"}
	case "both":
		bases = []string{"author:@me", "review-requested:@me"}
	default:
		bases = []string{"author:@me"}
	}
	seen := map[string]bool{}
	var out []github.PR
	for _, base := range bases {
		q, err := github.Query(base, repos)
		if err != nil {
			return nil, err
		}
		prs, err := a.searchPRs(ctx, q, fresh)
		if err != nil {
			return nil, err
		}
		for _, pr := range prs {
			if !seen[pr.URL] {
				seen[pr.URL] = true
				out = append(out, pr)
			}
		}
	}
	return out, nil
}

// ClaudeStatus returns the account and usage regardless of workspace.
func (a *App) ClaudeStatus() ClaudeUsageData {
	if err := a.unlocked(); err != nil {
		return ClaudeUsageData{AlertPercent: 90, UsageError: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return a.claudeData(ctx, 90)
}

func (a *App) claudeData(ctx context.Context, alertPercent int) ClaudeUsageData {
	d := ClaudeUsageData{AlertPercent: alertPercent}
	if a.deps.Claude == nil {
		d.UsageError = "Claude 계정 정보를 읽을 수 없습니다"
		return d
	}
	login, err := a.deps.Claude.Login()
	if err != nil {
		d.UsageError = err.Error()
		return d
	}
	d.Login = login
	if !login.LoggedIn {
		d.UsageError = "Claude Code 에 로그인돼 있지 않습니다"
		return d
	}
	usage, err := a.deps.Claude.Usage(ctx)
	if err != nil {
		d.UsageError = err.Error()
		return d
	}
	d.Usage = usage
	for _, w := range usage.Windows {
		if w.Percent >= float64(alertPercent) {
			d.Alert = true
		}
	}
	return d
}

// widgetTimeout is how long a widget may take to load. Connector lookups
// start a headless Claude session (user hooks, MCP servers) and take about a
// minute; deploy status probes many slots.
func widgetTimeout(typ string) time.Duration {
	switch typ {
	case widget.LinearIssues, widget.LinearInbox, widget.NotionSpecs:
		return 4 * time.Minute
	case widget.DeploySwap, widget.Command:
		return 2 * time.Minute
	case widget.Worktrees:
		return time.Minute
	default:
		return 30 * time.Second
	}
}

// WidgetData returns data for the widget at index in a workspace.
func (a *App) WidgetData(workspaceID string, index int) WidgetResult {
	return a.widgetData(workspaceID, index, false)
}

// RefreshWidget is WidgetData without cached results.
func (a *App) RefreshWidget(workspaceID string, index int) WidgetResult {
	return a.widgetData(workspaceID, index, true)
}

func (a *App) widgetData(workspaceID string, index int, fresh bool) WidgetResult {
	res := WidgetResult{FetchedAt: a.now()}
	if err := a.unlocked(); err != nil {
		res.Error = err.Error()
		return res
	}
	ws, err := a.loadWorkspace(workspaceID)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	if index < 0 || index >= len(ws.Widgets) {
		res.Error = fmt.Sprintf("위젯 #%d 이 없습니다", index)
		return res
	}
	inst := ws.Widgets[index]
	res.Type = inst.Type
	resolved, err := inst.ResolvedSettings()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	s := widgetdata.Settings(resolved)
	ctx, cancel := context.WithTimeout(a.life, widgetTimeout(inst.Type))
	defer cancel()

	data, err := a.buildWidget(ctx, ws, inst.Type, s, fresh)
	var setup needsSetup
	if errors.As(err, &setup) {
		res.Setup = setup.msg
		return res
	}
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.Data = data
	return res
}

func (a *App) buildWidget(ctx context.Context, ws workspace.Workspace, typ string, s widgetdata.Settings, fresh bool) (any, error) {
	switch typ {
	case widget.PRReviews:
		prs, err := a.prsFor(ctx, s.String("scope", "mine"), s.Strings("repos"), fresh)
		if err != nil {
			return nil, err
		}
		return widgetdata.BuildPRReviews(prs, s), nil
	case widget.CIFailures:
		prs, err := a.prsFor(ctx, s.String("scope", "mine"), s.Strings("repos"), fresh)
		if err != nil {
			return nil, err
		}
		return widgetdata.BuildCIFailures(prs), nil
	case widget.ReviewQueue:
		prs, err := a.prsFor(ctx, "review-requested", s.Strings("repos"), fresh)
		if err != nil {
			return nil, err
		}
		return widgetdata.BuildReviewQueue(prs, s, a.now()), nil
	case widget.ClaudeUsage:
		return a.claudeData(ctx, s.Int("alertPercent", 90)), nil
	default:
		return a.buildLocalWidget(ctx, ws, typ, s, fresh)
	}
}
