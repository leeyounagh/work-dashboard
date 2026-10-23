package widgetdata

import (
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/github"
)

// ReviewerStatus is one reviewer's latest position on a PR.
type ReviewerStatus struct {
	Login string    `json:"login"`
	State string    `json:"state"` // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING (requested, not reviewed)
	At    time.Time `json:"at"`
	// Rerequested: review was requested again after this reviewer's last review.
	Rerequested bool `json:"rerequested,omitempty"`
}

// PRRef is the part of a PR every list shows.
type PRRef struct {
	Number int       `json:"number"`
	Title  string    `json:"title"`
	URL    string    `json:"url"`
	Repo   string    `json:"repo"`
	Author string    `json:"author"`
	Draft  bool      `json:"draft"`
	Base   string    `json:"base"`
	Since  time.Time `json:"since"` // created
}

func ref(pr github.PR) PRRef {
	return PRRef{Number: pr.Number, Title: pr.Title, URL: pr.URL, Repo: pr.Repo, Author: pr.Author, Draft: pr.Draft, Base: pr.Base, Since: pr.CreatedAt}
}

func decisive(state string) bool { return state == "APPROVED" || state == "CHANGES_REQUESTED" }

// Reviewers returns each reviewer's latest position, the way GitHub shows it:
// the latest approve/request-changes wins over later comments; a dismissal
// clears the decision; requested reviewers who have not reviewed are PENDING,
// and ones asked again after reviewing are flagged Rerequested.
// The PR author is excluded.
func Reviewers(pr github.PR) []ReviewerStatus {
	reviews := slices.Clone(pr.Reviews)
	sort.SliceStable(reviews, func(i, j int) bool { return reviews[i].SubmittedAt.Before(reviews[j].SubmittedAt) })

	latest := map[string]ReviewerStatus{}
	var order []string
	for _, r := range reviews {
		if strings.EqualFold(r.Author, pr.Author) || r.State == "PENDING" || r.Author == "" {
			continue
		}
		key := strings.ToLower(r.Author)
		cur, seen := latest[key]
		if !seen {
			order = append(order, key)
		}
		// A comment after a decision does not undo the decision.
		if r.State == "COMMENTED" && seen && decisive(cur.State) {
			continue
		}
		latest[key] = ReviewerStatus{Login: r.Author, State: r.State, At: r.SubmittedAt}
	}
	requested := map[string]bool{}
	for _, req := range pr.Requested {
		requested[strings.ToLower(req)] = true
	}
	out := make([]ReviewerStatus, 0, len(order)+len(pr.Requested))
	for _, key := range order {
		st := latest[key]
		st.Rerequested = requested[key]
		out = append(out, st)
	}
	for _, req := range pr.Requested {
		if _, ok := latest[strings.ToLower(req)]; !ok && req != "" {
			out = append(out, ReviewerStatus{Login: req, State: "PENDING"})
		}
	}
	return out
}

// PRReview is one row of the PR review widget.
type PRReview struct {
	PRRef
	Reviewers  []ReviewerStatus `json:"reviewers"`
	Approvals  int              `json:"approvals"`
	Highlights []string         `json:"highlights"` // no-review, changes-requested, needs-approval
	Checks     string           `json:"checks"`
}

// PRSummary counts PRs per highlight.
type PRSummary struct {
	Total            int `json:"total"`
	NoReview         int `json:"noReview"`
	ChangesRequested int `json:"changesRequested"`
	NeedsApproval    int `json:"needsApproval"`
}

// PRReviewsData feeds the PR review widget.
type PRReviewsData struct {
	Items   []PRReview `json:"items"`
	Summary PRSummary  `json:"summary"`
}

// BuildPRReviews applies reviewer filters and highlight rules. With a
// reviewer filter, only those reviewers count (e.g. "no review from X yet").
func BuildPRReviews(prs []github.PR, s Settings) PRReviewsData {
	filter := map[string]bool{}
	for _, r := range s.Strings("reviewers") {
		filter[strings.ToLower(strings.TrimSpace(r))] = true
	}
	minApprovals := s.Int("minApprovals", 1)
	d := PRReviewsData{Items: []PRReview{}}
	for _, pr := range prs {
		all := Reviewers(pr)
		var shown []ReviewerStatus
		for _, r := range all {
			if len(filter) == 0 || filter[strings.ToLower(r.Login)] {
				shown = append(shown, r)
			}
		}
		item := PRReview{PRRef: ref(pr), Reviewers: shown, Checks: pr.ChecksState, Highlights: []string{}}
		reviewed, changes := 0, false
		for _, r := range shown {
			switch r.State {
			case "APPROVED":
				item.Approvals++
				reviewed++
			case "CHANGES_REQUESTED":
				changes = true
				reviewed++
			case "COMMENTED", "DISMISSED":
				reviewed++
			}
		}
		if s.Bool("highlightNoReview", true) && reviewed == 0 {
			item.Highlights = append(item.Highlights, "no-review")
			d.Summary.NoReview++
		}
		if s.Bool("highlightChangesRequested", true) && changes {
			item.Highlights = append(item.Highlights, "changes-requested")
			d.Summary.ChangesRequested++
		}
		noReviewShown := s.Bool("highlightNoReview", true) && reviewed == 0
		if !noReviewShown && item.Approvals < minApprovals && !changes {
			item.Highlights = append(item.Highlights, "needs-approval")
			d.Summary.NeedsApproval++
		}
		d.Items = append(d.Items, item)
	}
	d.Summary.Total = len(d.Items)
	// Most highlights first, then oldest first.
	sort.SliceStable(d.Items, func(i, j int) bool {
		a, b := d.Items[i], d.Items[j]
		if len(a.Highlights) != len(b.Highlights) {
			return len(a.Highlights) > len(b.Highlights)
		}
		return a.Since.Before(b.Since)
	})
	return d
}

// CIFailure is a PR with failing checks.
type CIFailure struct {
	PRRef
	Failed  []github.Check `json:"failed"`
	Running int            `json:"running"`
}

// CIFailuresData feeds the CI failure widget.
type CIFailuresData struct {
	Items []CIFailure `json:"items"`
}

var runningStates = []string{"IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}

// BuildCIFailures lists PRs whose latest commit has failing checks.
func BuildCIFailures(prs []github.PR) CIFailuresData {
	d := CIFailuresData{Items: []CIFailure{}}
	for _, pr := range prs {
		item := CIFailure{PRRef: ref(pr), Failed: []github.Check{}}
		for _, c := range pr.Checks {
			if c.Failed {
				item.Failed = append(item.Failed, c)
			} else if slices.Contains(runningStates, c.State) {
				item.Running++
			}
		}
		if len(item.Failed) > 0 || pr.ChecksState == "FAILURE" || pr.ChecksState == "ERROR" {
			d.Items = append(d.Items, item)
		}
	}
	return d
}

// QueueItem is a PR waiting for my review.
type QueueItem struct {
	PRRef
	WaitingHours int  `json:"waitingHours"`
	Stale        bool `json:"stale"`
}

// ReviewQueueData feeds the review queue widget.
type ReviewQueueData struct {
	Items      []QueueItem `json:"items"`
	StaleCount int         `json:"staleCount"`
}

// BuildReviewQueue orders review requests oldest first and flags stale ones.
func BuildReviewQueue(prs []github.PR, s Settings, now time.Time) ReviewQueueData {
	staleHours := s.Int("staleHours", 24)
	d := ReviewQueueData{Items: []QueueItem{}}
	for _, pr := range prs {
		hours := int(now.Sub(pr.CreatedAt).Hours())
		item := QueueItem{PRRef: ref(pr), WaitingHours: hours, Stale: hours >= staleHours}
		if item.Stale {
			d.StaleCount++
		}
		d.Items = append(d.Items, item)
	}
	sort.SliceStable(d.Items, func(i, j int) bool { return d.Items[i].Since.Before(d.Items[j].Since) })
	return d
}
