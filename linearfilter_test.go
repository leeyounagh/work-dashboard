package main

import (
	"slices"
	"testing"
)

func TestLinearGroup(t *testing.T) {
	tests := []struct {
		state, statusType, want string
	}{
		{"Todo", "unstarted", "todo"},
		{"Backlog", "backlog", "todo"},
		{"Triage", "triage", "todo"},
		{"In Progress", "started", "doing"},
		{"In Review", "started", "review"},
		{"Test Passed", "started", "review"},
		{"QA 중", "started", "review"},
		{"검수 대기", "started", "review"},
		{"Todo", "", "todo"},
	}
	for _, tt := range tests {
		if got := linearGroup(tt.state, tt.statusType); got != tt.want {
			t.Errorf("linearGroup(%q, %q) = %q, want %q", tt.state, tt.statusType, got, tt.want)
		}
	}
}

func TestSortLinearIssuesPutsWorkFirst(t *testing.T) {
	in := []LinearIssue{
		{ID: "GRO-3", State: "In Review", StatusType: "started"},
		{ID: "GRO-1", State: "Todo", StatusType: "unstarted"},
		{ID: "GRO-2", State: "In Progress", StatusType: "started"},
		{ID: "GRO-4", State: "Backlog", StatusType: "backlog"},
	}
	out := groupLinearIssues(in)
	ids := []string{}
	for _, is := range out {
		ids = append(ids, is.ID+":"+is.Group)
	}
	if want := []string{"GRO-1:todo", "GRO-4:todo", "GRO-2:doing", "GRO-3:review"}; !slices.Equal(ids, want) {
		t.Fatalf("order = %v, want %v", ids, want)
	}
	if in[0].Group != "" {
		t.Fatal("input must not be modified")
	}
}

func TestFilterMyNotifications(t *testing.T) {
	mine := []string{"GRO-1468", "gro-1243"}
	in := []LinearNotification{
		{ID: "a", Type: "pullRequestCommentMention", URL: "https://linear.app/x/review/some-pr"},
		{ID: "b", Type: "issueNewComment", URL: "https://linear.app/x/issue/GRO-1468/login#comment-1"},
		{ID: "c", Type: "issueNewComment", URL: "https://linear.app/x/issue/GRO-1080/other#comment-2"},
		{ID: "d", Type: "issueAssignedToYou", URL: "https://linear.app/x/issue/GRO-9/new"},
		{ID: "e", Type: "issueStatusChanged", URL: "https://linear.app/x/issue/GRO-1243/sec"},
		{ID: "f", Type: "pullRequestCommented", URL: "https://linear.app/x/review/other-pr"},
		{ID: "g", Type: "issueCommentMention", URL: "https://linear.app/x/issue/GRO-5/y"},
	}
	out := filterMyNotifications(in, mine)
	got := []string{}
	for _, n := range out {
		got = append(got, n.ID+":"+n.Kind)
	}
	if want := []string{"a:mention", "b:comment", "d:assigned", "e:status", "g:mention"}; !slices.Equal(got, want) {
		t.Fatalf("kept = %v, want %v", got, want)
	}
}
