// Package github fetches pull requests through the GitHub CLI (gh), so the
// dashboard uses the user's existing gh login and never stores a token.
package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// Runner runs gh with arguments and returns stdout.
type Runner func(ctx context.Context, args ...string) ([]byte, error)

// GH runs the real gh CLI.
func GH(ctx context.Context, args ...string) ([]byte, error) {
	cmd := procutil.Background(exec.CommandContext(ctx, "gh", args...))
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, fmt.Errorf("gh %s: %s", args[0], strings.TrimSpace(string(exitErr.Stderr)))
		}
		return nil, fmt.Errorf("gh 를 실행하지 못했습니다(GitHub CLI 설치·로그인 확인): %w", err)
	}
	return out, nil
}

// Review is one submitted review.
type Review struct {
	Author      string    `json:"author"`
	State       string    `json:"state"` // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED
	SubmittedAt time.Time `json:"submittedAt"`
}

// Check is one CI check or commit status.
type Check struct {
	Name   string `json:"name"`
	State  string `json:"state"` // conclusion for check runs, state for statuses
	URL    string `json:"url"`
	Failed bool   `json:"failed"`
}

// PR is a pull request with what the widgets need.
type PR struct {
	Number         int       `json:"number"`
	Title          string    `json:"title"`
	URL            string    `json:"url"`
	Repo           string    `json:"repo"`
	Author         string    `json:"author"`
	Draft          bool      `json:"draft"`
	Base           string    `json:"base"`
	Head           string    `json:"head"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ReviewDecision string    `json:"reviewDecision"`
	Requested      []string  `json:"requested"` // reviewers asked but not yet reviewed
	Reviews        []Review  `json:"reviews"`
	ChecksState    string    `json:"checksState"` // SUCCESS, FAILURE, PENDING, ERROR, "" (no checks)
	Checks         []Check   `json:"checks"`
}

const searchQuery = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt reviewDecision
        author { login }
        repository { nameWithOwner }
        baseRefName headRefName
        reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
        reviews(first: 100) { nodes { author { login } state submittedAt } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
          ... on CheckRun { name conclusion status detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
      }
    }
  }
}`

type gqlResponse struct {
	Data struct {
		Search struct {
			Nodes []gqlPR `json:"nodes"`
		} `json:"search"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type login struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

type gqlPR struct {
	Number         int       `json:"number"`
	Title          string    `json:"title"`
	URL            string    `json:"url"`
	IsDraft        bool      `json:"isDraft"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ReviewDecision *string   `json:"reviewDecision"`
	Author         *login    `json:"author"`
	Repository     struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	BaseRefName    string `json:"baseRefName"`
	HeadRefName    string `json:"headRefName"`
	ReviewRequests struct {
		Nodes []struct {
			RequestedReviewer *login `json:"requestedReviewer"`
		} `json:"nodes"`
	} `json:"reviewRequests"`
	Reviews struct {
		Nodes []struct {
			Author      *login    `json:"author"`
			State       string    `json:"state"`
			SubmittedAt time.Time `json:"submittedAt"`
		} `json:"nodes"`
	} `json:"reviews"`
	Commits struct {
		Nodes []struct {
			Commit struct {
				StatusCheckRollup *struct {
					State    string `json:"state"`
					Contexts struct {
						Nodes []struct {
							Name       string `json:"name"`
							Conclusion string `json:"conclusion"`
							Status     string `json:"status"`
							DetailsURL string `json:"detailsUrl"`
							Context    string `json:"context"`
							State      string `json:"state"`
							TargetURL  string `json:"targetUrl"`
						} `json:"nodes"`
					} `json:"contexts"`
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"commits"`
}

var failedConclusions = map[string]bool{
	"FAILURE": true, "ERROR": true, "TIMED_OUT": true, "CANCELLED": true,
	"ACTION_REQUIRED": true, "STARTUP_FAILURE": true,
}

func (l *login) name() string {
	if l == nil {
		return "ghost" // deleted account
	}
	if l.Login != "" {
		return l.Login
	}
	return l.Name
}

func convert(n gqlPR) PR {
	pr := PR{
		Number: n.Number, Title: n.Title, URL: n.URL, Repo: n.Repository.NameWithOwner,
		Author: n.Author.name(), Draft: n.IsDraft, Base: n.BaseRefName, Head: n.HeadRefName,
		CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
	}
	if n.ReviewDecision != nil {
		pr.ReviewDecision = *n.ReviewDecision
	}
	for _, r := range n.ReviewRequests.Nodes {
		if r.RequestedReviewer != nil {
			pr.Requested = append(pr.Requested, r.RequestedReviewer.name())
		}
	}
	for _, r := range n.Reviews.Nodes {
		pr.Reviews = append(pr.Reviews, Review{Author: r.Author.name(), State: r.State, SubmittedAt: r.SubmittedAt})
	}
	if len(n.Commits.Nodes) > 0 && n.Commits.Nodes[0].Commit.StatusCheckRollup != nil {
		roll := n.Commits.Nodes[0].Commit.StatusCheckRollup
		pr.ChecksState = roll.State
		for _, c := range roll.Contexts.Nodes {
			if c.Name != "" { // CheckRun
				state := c.Conclusion
				if state == "" {
					state = c.Status
				}
				pr.Checks = append(pr.Checks, Check{Name: c.Name, State: state, URL: c.DetailsURL, Failed: failedConclusions[c.Conclusion]})
			} else if c.Context != "" { // StatusContext
				pr.Checks = append(pr.Checks, Check{Name: c.Context, State: c.State, URL: c.TargetURL, Failed: failedConclusions[c.State]})
			}
		}
	}
	return pr
}

// repoPattern keeps repo filters to owner/name so they cannot add search qualifiers.
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// Query builds a GitHub search query for open PRs.
func Query(base string, repos []string) (string, error) {
	q := "is:open is:pr archived:false " + base
	for _, r := range repos {
		if !repoPattern.MatchString(r) {
			return "", fmt.Errorf("레포 이름 %q 는 owner/name 형식이어야 합니다", r)
		}
		q += " repo:" + r
	}
	return q, nil
}

// Search runs a PR search query.
func Search(ctx context.Context, run Runner, query string) ([]PR, error) {
	out, err := run(ctx, "api", "graphql", "-f", "query="+searchQuery, "-f", "q="+query)
	if err != nil {
		return nil, err
	}
	var res gqlResponse
	if err := json.Unmarshal(out, &res); err != nil {
		return nil, fmt.Errorf("GitHub 응답을 해석하지 못했습니다: %w", err)
	}
	if len(res.Errors) > 0 {
		return nil, fmt.Errorf("GitHub: %s", res.Errors[0].Message)
	}
	prs := make([]PR, 0, len(res.Data.Search.Nodes))
	for _, n := range res.Data.Search.Nodes {
		if n.URL != "" { // non-PR search hits decode as empty nodes
			prs = append(prs, convert(n))
		}
	}
	return prs, nil
}
