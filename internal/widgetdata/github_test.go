package widgetdata

import (
	"slices"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/github"
)

var t0 = time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)

func prs() []github.PR {
	return []github.PR{
		{ // reviewed with changes requested by alice, approved by bob, carol requested
			Number: 1, Repo: "o/fe", Author: "me", CreatedAt: t0.Add(-48 * time.Hour),
			Requested: []string{"carol"},
			Reviews: []github.Review{
				{Author: "alice", State: "COMMENTED", SubmittedAt: t0.Add(-5 * time.Hour)},
				{Author: "alice", State: "CHANGES_REQUESTED", SubmittedAt: t0.Add(-4 * time.Hour)},
				{Author: "bob", State: "APPROVED", SubmittedAt: t0.Add(-3 * time.Hour)},
				{Author: "me", State: "COMMENTED", SubmittedAt: t0.Add(-2 * time.Hour)}, // author replies don't count
			},
			ChecksState: "SUCCESS",
		},
		{ // nobody reviewed yet, CI failing
			Number: 2, Repo: "o/be", Author: "me", CreatedAt: t0.Add(-2 * time.Hour), Requested: []string{"heywani"},
			ChecksState: "FAILURE",
			Checks: []github.Check{
				{Name: "lint", State: "SUCCESS"},
				{Name: "test", State: "FAILURE", Failed: true, URL: "https://ci/test"},
				{Name: "e2e", State: "IN_PROGRESS"},
			},
		},
		{ // alice changed her mind: approved after requesting changes
			Number: 3, Repo: "o/fe", Author: "me", CreatedAt: t0.Add(-30 * time.Hour), Draft: true,
			Reviews: []github.Review{
				{Author: "alice", State: "CHANGES_REQUESTED", SubmittedAt: t0.Add(-10 * time.Hour)},
				{Author: "alice", State: "APPROVED", SubmittedAt: t0.Add(-9 * time.Hour)},
			},
		},
	}
}

func TestReviewers(t *testing.T) {
	got := Reviewers(prs()[0])
	want := []ReviewerStatus{
		{Login: "alice", State: "CHANGES_REQUESTED", At: t0.Add(-4 * time.Hour)},
		{Login: "bob", State: "APPROVED", At: t0.Add(-3 * time.Hour)},
		{Login: "carol", State: "PENDING"},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("Reviewers = %+v\nwant %+v", got, want)
	}
	if got := Reviewers(prs()[2]); len(got) != 1 || got[0].State != "APPROVED" {
		t.Fatalf("latest decisive review must win: %+v", got)
	}
}

func TestBuildPRReviewsAllReviewers(t *testing.T) {
	d := BuildPRReviews(prs(), Settings{"highlightNoReview": true, "highlightChangesRequested": true, "minApprovals": 1, "reviewers": []string{}})
	if len(d.Items) != 3 {
		t.Fatalf("items = %d", len(d.Items))
	}
	byNum := map[int]PRReview{}
	for _, it := range d.Items {
		byNum[it.Number] = it
	}
	if !slices.Equal(byNum[1].Highlights, []string{"changes-requested"}) {
		t.Errorf("#1 highlights = %v", byNum[1].Highlights)
	}
	// "no review" already says it all; "needs approval" is only for reviewed PRs.
	if !slices.Equal(byNum[2].Highlights, []string{"no-review"}) {
		t.Errorf("#2 highlights = %v", byNum[2].Highlights)
	}
	if len(byNum[3].Highlights) != 0 || byNum[3].Approvals != 1 {
		t.Errorf("#3 = %+v", byNum[3])
	}
	if d.Summary != (PRSummary{Total: 3, NoReview: 1, ChangesRequested: 1, NeedsApproval: 0}) {
		t.Errorf("summary = %+v", d.Summary)
	}
	// Items needing attention come first (oldest first among equals); the clean one last.
	if d.Items[0].Number != 1 || d.Items[1].Number != 2 || d.Items[2].Number != 3 {
		t.Errorf("order = %d, %d, %d", d.Items[0].Number, d.Items[1].Number, d.Items[2].Number)
	}
}

func TestBuildPRReviewsFilteredToOneReviewer(t *testing.T) {
	// "heywani 리뷰 0회" style rule: only one reviewer counts.
	d := BuildPRReviews(prs(), Settings{"highlightNoReview": true, "highlightChangesRequested": false, "minApprovals": 0, "reviewers": []any{"HeyWani"}})
	for _, it := range d.Items {
		if !slices.Equal(it.Highlights, []string{"no-review"}) {
			t.Errorf("#%d highlights = %v, want no-review for the filtered reviewer", it.Number, it.Highlights)
		}
		for _, r := range it.Reviewers {
			if r.Login != "heywani" {
				t.Errorf("#%d shows reviewer %s outside the filter", it.Number, r.Login)
			}
		}
	}
	if d.Summary.NoReview != 3 {
		t.Errorf("summary = %+v", d.Summary)
	}
}

func TestBuildCIFailures(t *testing.T) {
	d := BuildCIFailures(prs())
	if len(d.Items) != 1 || d.Items[0].Number != 2 {
		t.Fatalf("items = %+v", d.Items)
	}
	it := d.Items[0]
	if len(it.Failed) != 1 || it.Failed[0].Name != "test" || it.Running != 1 {
		t.Fatalf("item = %+v", it)
	}
}

func TestBuildReviewQueue(t *testing.T) {
	d := BuildReviewQueue(prs(), Settings{"staleHours": 24}, t0)
	if len(d.Items) != 3 {
		t.Fatalf("items = %d", len(d.Items))
	}
	// Oldest first.
	if d.Items[0].Number != 1 || d.Items[0].WaitingHours != 48 || !d.Items[0].Stale {
		t.Fatalf("first = %+v", d.Items[0])
	}
	if d.Items[2].Number != 2 || d.Items[2].Stale {
		t.Fatalf("last = %+v", d.Items[2])
	}
	if d.StaleCount != 2 {
		t.Fatalf("stale = %d", d.StaleCount)
	}
}

func TestSettingsHelpers(t *testing.T) {
	s := Settings{"n": float64(3), "i": 4, "b": true, "l": []any{"a", 1, "b"}, "ls": []string{"x"}}
	if s.Int("n", 0) != 3 || s.Int("i", 0) != 4 || s.Int("missing", 7) != 7 {
		t.Error("Int")
	}
	if !s.Bool("b", false) || s.Bool("missing", true) != true {
		t.Error("Bool")
	}
	if !slices.Equal(s.Strings("l"), []string{"a", "b"}) || !slices.Equal(s.Strings("ls"), []string{"x"}) || s.Strings("missing") != nil {
		t.Error("Strings")
	}
	if s.String("missing", "d") != "d" {
		t.Error("String")
	}
}
