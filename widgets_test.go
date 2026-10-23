package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/claudeacct"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

const prFixture = `{"data":{"search":{"nodes":[
 {"number":7,"title":"t","url":"https://github.com/o/r/pull/7","isDraft":false,
  "createdAt":"2026-10-20T00:00:00Z","updatedAt":"2026-10-20T00:00:00Z","reviewDecision":null,
  "author":{"login":"me"},"repository":{"nameWithOwner":"o/r"},"baseRefName":"main","headRefName":"x",
  "reviewRequests":{"nodes":[]},"reviews":{"nodes":[]},
  "commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE","contexts":{"nodes":[
    {"name":"test","conclusion":"FAILURE","status":"COMPLETED","detailsUrl":"u"}]}}}}]}}]}}}`

type fakeGH struct {
	mu      sync.Mutex
	queries []string
	err     error
}

func (f *fakeGH) run(_ context.Context, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range args {
		if strings.HasPrefix(a, "q=") {
			f.queries = append(f.queries, strings.TrimPrefix(a, "q="))
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return []byte(prFixture), nil
}

type fakeClaude struct {
	login claudeacct.Login
	usage claudeacct.Usage
	err   error
}

func (f fakeClaude) Login() (claudeacct.Login, error) { return f.login, nil }
func (f fakeClaude) Usage(context.Context) (claudeacct.Usage, error) {
	return f.usage, f.err
}

func widgetHarness(t *testing.T, widgets ...widget.Instance) (*harness, *fakeGH, workspace.Workspace) {
	t.Helper()
	h := newHarness(t)
	gh := &fakeGH{}
	h.app.deps.GitHub = gh.run
	h.app.deps.Claude = fakeClaude{
		login: claudeacct.Login{LoggedIn: true, Email: "me@example.com"},
		usage: claudeacct.Usage{Windows: []claudeacct.Window{{Key: "five_hour", Label: "5시간", Percent: 91}}},
	}
	h.app.deps.Now = func() time.Time { return time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC) }
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "w", Folders: []string{t.TempDir()}, Widgets: widgets})
	if err != nil {
		t.Fatal(err)
	}
	return h, gh, ws
}

func TestWidgetDataPRReviews(t *testing.T) {
	h, gh, ws := widgetHarness(t, widget.Instance{Type: widget.PRReviews, Enabled: true, Settings: map[string]any{"scope": "both", "repos": []any{"o/r"}}})
	res := h.app.WidgetData(ws.ID, 0)
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	d := res.Data.(widgetdata.PRReviewsData)
	// "both" runs two searches and dedupes the same PR.
	if len(d.Items) != 1 || d.Items[0].Number != 7 {
		t.Fatalf("items = %+v", d.Items)
	}
	if len(gh.queries) != 2 || !strings.Contains(gh.queries[0], "author:@me") || !strings.Contains(gh.queries[1], "review-requested:@me") ||
		!strings.Contains(gh.queries[0], "repo:o/r") {
		t.Fatalf("queries = %q", gh.queries)
	}

	// Cached: a second call does not run gh again.
	h.app.WidgetData(ws.ID, 0)
	if len(gh.queries) != 2 {
		t.Fatalf("expected cached results, queries = %d", len(gh.queries))
	}
	// Refresh bypasses the cache.
	h.app.RefreshWidget(ws.ID, 0)
	if len(gh.queries) != 4 {
		t.Fatalf("refresh should re-query, queries = %d", len(gh.queries))
	}
}

func TestWidgetDataCIAndQueue(t *testing.T) {
	h, _, ws := widgetHarness(t,
		widget.Instance{Type: widget.CIFailures, Enabled: true},
		widget.Instance{Type: widget.ReviewQueue, Enabled: true},
	)
	ci := h.app.WidgetData(ws.ID, 0).Data.(widgetdata.CIFailuresData)
	if len(ci.Items) != 1 || ci.Items[0].Failed[0].Name != "test" {
		t.Fatalf("ci = %+v", ci)
	}
	q := h.app.WidgetData(ws.ID, 1).Data.(widgetdata.ReviewQueueData)
	if len(q.Items) != 1 || q.Items[0].WaitingHours != 72 {
		t.Fatalf("queue = %+v", q)
	}
}

func TestWidgetDataClaudeUsage(t *testing.T) {
	h, _, ws := widgetHarness(t, widget.Instance{Type: widget.ClaudeUsage, Enabled: true, Settings: map[string]any{"alertPercent": 90}})
	d := h.app.WidgetData(ws.ID, 0).Data.(ClaudeUsageData)
	if !d.Login.LoggedIn || len(d.Usage.Windows) != 1 || !d.Alert || d.AlertPercent != 90 {
		t.Fatalf("claude = %+v", d)
	}
	// Without a workspace the panel still shows the account.
	if g := h.app.ClaudeStatus(); !g.Login.LoggedIn {
		t.Fatalf("ClaudeStatus = %+v", g)
	}
}

func TestWidgetDataErrors(t *testing.T) {
	h, gh, ws := widgetHarness(t,
		widget.Instance{Type: widget.PRReviews, Enabled: true},
		widget.Instance{Type: widget.SessionRestore, Enabled: true},
	)
	gh.err = errors.New("gh: not logged in")
	if res := h.app.WidgetData(ws.ID, 0); !strings.Contains(res.Error, "not logged in") {
		t.Fatalf("gh error = %+v", res)
	}
	if res := h.app.WidgetData(ws.ID, 9); res.Error == "" {
		t.Fatal("out-of-range index must error")
	}
	if res := h.app.WidgetData("missing", 0); res.Error == "" {
		t.Fatal("unknown workspace must error")
	}
	if res := h.app.WidgetData(ws.ID, 1); res.Error != "" || res.Data == nil {
		t.Fatalf("session-restore = %+v", res)
	}
}
