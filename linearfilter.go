package main

import (
	"regexp"
	"sort"
	"strings"
)

// Linear issue groups, in the order the widget shows them.
const (
	groupTodo   = "todo"   // not started: backlog, todo, triage
	groupDoing  = "doing"  // started and in my hands
	groupReview = "review" // started but waiting on review, QA or test
)

var (
	groupOrder  = map[string]int{groupTodo: 0, groupDoing: 1, groupReview: 2}
	reviewState = regexp.MustCompile(`(?i)review|test|qa|검수|리뷰|확인`)
	issueInURL  = regexp.MustCompile(`/issue/([A-Za-z][A-Za-z0-9]*-[0-9]+)`)
)

// linearGroup sorts an issue into what I have to do, what I am doing and
// what is waiting on someone else, from its state name and Linear's type.
func linearGroup(state, statusType string) string {
	switch {
	case statusType == "started" && reviewState.MatchString(state):
		return groupReview
	case statusType == "started":
		return groupDoing
	default:
		return groupTodo
	}
}

// groupLinearIssues returns a copy with groups set, work to do first.
func groupLinearIssues(in []LinearIssue) []LinearIssue {
	out := make([]LinearIssue, len(in))
	for i, is := range in {
		is.Group = linearGroup(is.State, is.StatusType)
		out[i] = is
	}
	sort.SliceStable(out, func(i, j int) bool { return groupOrder[out[i].Group] < groupOrder[out[j].Group] })
	return out
}

// notificationKind names a raw Linear notification type for the widget.
func notificationKind(typ string) string {
	t := strings.ToLower(typ)
	switch {
	case strings.Contains(t, "mention"):
		return "mention"
	case strings.Contains(t, "assigned"):
		return "assigned"
	case strings.Contains(t, "status"):
		return "status"
	case strings.Contains(t, "comment"), strings.Contains(t, "reaction"):
		return "comment"
	case strings.HasPrefix(t, "pullrequest"):
		return "review"
	default:
		return "other"
	}
}

// filterMyNotifications keeps what concerns me: mentions, assignments and
// anything about an issue I am assigned to (mine are issue identifiers).
func filterMyNotifications(in []LinearNotification, mine []string) []LinearNotification {
	assigned := map[string]bool{}
	for _, id := range mine {
		assigned[strings.ToUpper(id)] = true
	}
	out := []LinearNotification{}
	for _, n := range in {
		n.Kind = notificationKind(n.Type)
		issue := ""
		if m := issueInURL.FindStringSubmatch(n.URL); m != nil {
			issue = strings.ToUpper(m[1])
		}
		if n.Kind == "mention" || n.Kind == "assigned" || (issue != "" && assigned[issue]) {
			out = append(out, n)
		}
	}
	return out
}

// issueTeam is the team key of an identifier like GRO-123.
func issueTeam(id string) string {
	key, _, ok := strings.Cut(id, "-")
	if !ok {
		return ""
	}
	return strings.ToUpper(key)
}

// matchesAny reports whether one of the values names the wanted ones
// (ignoring case); no wanted values matches everything.
func matchesAny(wanted []string, values ...string) bool {
	if len(wanted) == 0 {
		return true
	}
	for _, w := range wanted {
		for _, v := range values {
			if v != "" && strings.EqualFold(w, v) {
				return true
			}
		}
	}
	return false
}

// filterLinearIssues keeps the issues of the given teams (key or name) and
// states. Filtering here, not in the prompt, lets every workspace share one lookup.
func filterLinearIssues(in []LinearIssue, teams, states []string) []LinearIssue {
	out := []LinearIssue{}
	for _, is := range in {
		if matchesAny(teams, issueTeam(is.ID), is.Team) && matchesAny(states, is.State) {
			out = append(out, is)
		}
	}
	return out
}

// filterNotificationsByTeam keeps notifications about the teams' issues.
// Ones not about an issue (a project or document mention) stay everywhere.
func filterNotificationsByTeam(in []LinearNotification, teams []string) []LinearNotification {
	out := []LinearNotification{}
	for _, n := range in {
		m := issueInURL.FindStringSubmatch(n.URL)
		if m == nil || matchesAny(teams, issueTeam(m[1])) {
			out = append(out, n)
		}
	}
	return out
}
