package main

import (
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

type stubLister struct {
	res workspace.ListResult
}

func (s stubLister) List() workspace.ListResult { return s.res }

func TestWorkspaces(t *testing.T) {
	want := workspace.ListResult{
		Workspaces: []workspace.Workspace{{ID: "a", Name: "A"}},
		Problems:   []string{"bad.json: parse error"},
	}
	got := NewApp(stubLister{res: want}).Workspaces()
	if len(got.Workspaces) != 1 || got.Workspaces[0].ID != "a" || len(got.Problems) != 1 {
		t.Fatalf("Workspaces() = %+v", got)
	}
}

func TestWidgetCatalogNotEmpty(t *testing.T) {
	if len(NewApp(stubLister{}).WidgetCatalog()) == 0 {
		t.Fatal("catalog should not be empty")
	}
}

func TestInfo(t *testing.T) {
	if NewApp(stubLister{}).Info().Version == "" {
		t.Fatal("version should be set")
	}
}
