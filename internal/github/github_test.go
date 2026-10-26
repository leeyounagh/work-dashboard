package github

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

const fixture = `{"data":{"search":{"nodes":[
 {"number":12,"title":"feat: x","url":"https://github.com/o/r/pull/12","isDraft":false,
  "createdAt":"2026-10-20T01:00:00Z","updatedAt":"2026-10-22T01:00:00Z","reviewDecision":"CHANGES_REQUESTED",
  "author":{"login":"me"},"repository":{"nameWithOwner":"o/r"},"baseRefName":"test","headRefName":"feature/x",
  "reviewRequests":{"nodes":[{"requestedReviewer":{"login":"carol"}},{"requestedReviewer":{"name":"frontend-team"}}]},
  "reviews":{"nodes":[
    {"author":{"login":"alice"},"state":"COMMENTED","submittedAt":"2026-10-21T01:00:00Z"},
    {"author":{"login":"alice"},"state":"CHANGES_REQUESTED","submittedAt":"2026-10-21T02:00:00Z"},
    {"author":null,"state":"APPROVED","submittedAt":"2026-10-21T03:00:00Z"}]},
  "commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE","contexts":{"nodes":[
    {"name":"lint","conclusion":"SUCCESS","status":"COMPLETED","detailsUrl":"https://ci/lint"},
    {"name":"test","conclusion":"FAILURE","status":"COMPLETED","detailsUrl":"https://ci/test"},
    {"name":"build","conclusion":"","status":"IN_PROGRESS","detailsUrl":"https://ci/build"},
    {"context":"deploy/preview","state":"ERROR","targetUrl":"https://ci/preview"}]}}}}]}},
 {"number":13,"title":"no checks","url":"https://github.com/o/r/pull/13","isDraft":true,
  "createdAt":"2026-10-22T01:00:00Z","updatedAt":"2026-10-22T01:00:00Z","reviewDecision":null,
  "author":{"login":"me"},"repository":{"nameWithOwner":"o/r"},"baseRefName":"main","headRefName":"y",
  "reviewRequests":{"nodes":[]},"reviews":{"nodes":[]},
  "comments":{"nodes":[
    {"author":{"login":"rev"},"createdAt":"2026-10-22T02:00:00Z","body":"리뷰 회차: 1\n\n<!-- review-gate verdict=Block -->\n**결과:** Block"},
    {"author":{"login":"pm"},"createdAt":"2026-10-22T03:00:00Z","body":"PM 결정: B 로 갑니다"},
    {"author":{"login":"rev"},"createdAt":"2026-10-22T04:00:00Z","body":"<!--review-gate verdict=Warning-->"},
    {"author":{"login":"rev"},"createdAt":"2026-10-22T05:00:00Z","body":"<!-- review-gate verdict=Approve -->"},
    {"author":{"login":"rev"},"createdAt":"2026-10-22T06:00:00Z","body":"<!-- review-gate verdict=Maybe -->"}]},
  "commits":{"nodes":[{"commit":{"statusCheckRollup":null}}]}},
 {}
]}}}`

func fakeRunner(out string, err error, gotArgs *[]string) Runner {
	return func(_ context.Context, args ...string) ([]byte, error) {
		*gotArgs = args
		return []byte(out), err
	}
}

func TestSearch(t *testing.T) {
	var args []string
	prs, err := Search(context.Background(), fakeRunner(fixture, nil, &args), "is:open author:@me")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(args, "q=is:open author:@me") || args[0] != "api" || args[1] != "graphql" {
		t.Fatalf("args = %q", args)
	}
	if len(prs) != 2 {
		t.Fatalf("prs = %d, want 2 (empty node skipped)", len(prs))
	}
	pr := prs[0]
	if pr.Repo != "o/r" || pr.Base != "test" || pr.ReviewDecision != "CHANGES_REQUESTED" || pr.Author != "me" {
		t.Fatalf("pr = %+v", pr)
	}
	if !slices.Equal(pr.Requested, []string{"carol", "frontend-team"}) {
		t.Fatalf("requested = %v", pr.Requested)
	}
	if len(pr.Reviews) != 3 || pr.Reviews[2].Author != "ghost" {
		t.Fatalf("reviews = %+v", pr.Reviews)
	}
	if pr.ChecksState != "FAILURE" || len(pr.Checks) != 4 {
		t.Fatalf("checks = %+v", pr.Checks)
	}
	failed := []string{}
	for _, c := range pr.Checks {
		if c.Failed {
			failed = append(failed, c.Name)
		}
	}
	if !slices.Equal(failed, []string{"test", "deploy/preview"}) {
		t.Fatalf("failed = %v", failed)
	}
	if pr.Checks[2].State != "IN_PROGRESS" {
		t.Fatalf("running check state = %q", pr.Checks[2].State)
	}
	if prs[1].ChecksState != "" || !prs[1].Draft {
		t.Fatalf("pr 13 = %+v", prs[1])
	}
}

// Reviews posted as PR comments by the review-gate tool count as reviews;
// other comments do not.
func TestSearchReviewGateComments(t *testing.T) {
	var args []string
	prs, err := Search(context.Background(), fakeRunner(fixture, nil, &args), "q")
	if err != nil {
		t.Fatal(err)
	}
	got := prs[1].Reviews
	want := []string{"CHANGES_REQUESTED", "COMMENTED", "APPROVED"}
	if len(got) != len(want) {
		t.Fatalf("reviews = %+v", got)
	}
	for i, r := range got {
		if r.State != want[i] || r.Author != "rev" || !r.Gate {
			t.Fatalf("review %d = %+v, want %s from rev", i, r, want[i])
		}
	}
	if got[0].SubmittedAt.Hour() != 2 {
		t.Fatalf("submittedAt = %v, want the comment time", got[0].SubmittedAt)
	}
	if prs[0].Reviews[0].Gate {
		t.Fatal("a real review is not a review-gate comment")
	}
}

func TestSearchErrors(t *testing.T) {
	var args []string
	if _, err := Search(context.Background(), fakeRunner("", errors.New("gh: not logged in"), &args), "q"); err == nil {
		t.Fatal("runner error must propagate")
	}
	if _, err := Search(context.Background(), fakeRunner(`{"errors":[{"message":"bad query"}]}`, nil, &args), "q"); err == nil || !strings.Contains(err.Error(), "bad query") {
		t.Fatalf("graphql error = %v", err)
	}
	if _, err := Search(context.Background(), fakeRunner(`not json`, nil, &args), "q"); err == nil {
		t.Fatal("bad JSON must fail")
	}
}

func TestQuery(t *testing.T) {
	q, err := Query("author:@me", []string{"o/r", "o/other.repo"})
	if err != nil || q != "is:open is:pr archived:false author:@me repo:o/r repo:o/other.repo" {
		t.Fatalf("Query = %q, %v", q, err)
	}
	for _, bad := range []string{"o/r is:closed", "justname", "o/r/x"} {
		if _, err := Query("author:@me", []string{bad}); err == nil {
			t.Errorf("repo %q should be rejected", bad)
		}
	}
}
