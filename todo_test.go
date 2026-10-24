package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/widget"
)

func todoHarness(t *testing.T) (*harness, string, *time.Time) {
	t.Helper()
	h, ws, _, _ := localHarness(t, widget.Instance{Type: widget.Todo, Enabled: true})
	h.app.deps.TodosDir = filepath.Join(t.TempDir(), "todos")
	now := time.Date(2026, 10, 24, 9, 0, 0, 0, time.Local)
	h.app.deps.Now = func() time.Time { return now }
	return h, ws.ID, &now
}

func TestTodoAddCheckDelete(t *testing.T) {
	h, wsID, _ := todoHarness(t)
	list, err := h.app.AddTodo(wsID, "  PR 리뷰 반영  ")
	if err != nil || len(list) != 1 || list[0].Text != "PR 리뷰 반영" || list[0].Done {
		t.Fatalf("add = %+v, %v", list, err)
	}
	if list, err = h.app.AddTodo(wsID, "배포 확인"); err != nil || len(list) != 2 {
		t.Fatalf("add 2 = %+v, %v", list, err)
	}
	id := list[0].ID
	if list, err = h.app.SetTodoDone(wsID, id, true); err != nil || !list[0].Done {
		t.Fatalf("check = %+v, %v", list, err)
	}
	if list, err = h.app.DeleteTodo(wsID, list[1].ID); err != nil || len(list) != 1 {
		t.Fatalf("delete = %+v, %v", list, err)
	}
	// The widget shows the same list.
	res := h.app.WidgetData(wsID, 0)
	d, ok := res.Data.(TodoData)
	if res.Error != "" || !ok || len(d.Items) != 1 || !d.Items[0].Done {
		t.Fatalf("widget = %+v", res)
	}
}

func TestTodoDoneItemsLeaveTheNextDay(t *testing.T) {
	h, wsID, now := todoHarness(t)
	list, _ := h.app.AddTodo(wsID, "어제 끝낸 일")
	_, _ = h.app.AddTodo(wsID, "아직 남은 일")
	_, _ = h.app.SetTodoDone(wsID, list[0].ID, true)
	*now = now.Add(24 * time.Hour)
	d := h.app.WidgetData(wsID, 0).Data.(TodoData)
	if len(d.Items) != 1 || d.Items[0].Text != "아직 남은 일" {
		t.Fatalf("next day = %+v", d.Items)
	}
}

func TestTodoRejectsBadInput(t *testing.T) {
	h, wsID, _ := todoHarness(t)
	for _, text := range []string{"", "   ", strings.Repeat("가", 201)} {
		if _, err := h.app.AddTodo(wsID, text); err == nil {
			t.Errorf("AddTodo(%.10q) should fail", text)
		}
	}
	if list, _ := h.app.AddTodo(wsID, "줄\n바꿈\x1b[31m"); list[0].Text != "줄 바꿈 [31m" {
		t.Errorf("control characters kept: %q", list[0].Text)
	}
	if _, err := h.app.SetTodoDone(wsID, "nope", true); err == nil {
		t.Error("unknown id should fail")
	}
	if _, err := h.app.AddTodo("../evil", "x"); err == nil {
		t.Error("unknown workspace should fail")
	}
}
