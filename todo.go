package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/leeyounagh/work-dashboard/internal/fsutil"
)

// Todo is one line of a workspace's "오늘 할 일" list.
type Todo struct {
	ID      string     `json:"id"`
	Text    string     `json:"text"`
	Done    bool       `json:"done"`
	Created time.Time  `json:"created"`
	DoneAt  *time.Time `json:"doneAt,omitempty"`
}

// TodoData feeds the to-do widget.
type TodoData struct {
	Items []Todo `json:"items"`
}

const (
	maxTodoRunes = 200
	maxTodos     = 200
)

// todoPath is the workspace's list file. The workspace must exist, so its
// ID (checked when saved) is a safe file name.
func (a *App) todoPath(workspaceID string) (string, error) {
	if err := a.unlocked(); err != nil {
		return "", err
	}
	if _, err := a.loadWorkspace(workspaceID); err != nil {
		return "", err
	}
	if a.deps.TodosDir == "" {
		return "", errors.New("할 일을 저장할 곳이 없습니다")
	}
	return filepath.Join(a.deps.TodosDir, workspaceID+".json"), nil
}

func readTodos(path string) ([]Todo, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return []Todo{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("할 일을 읽지 못했습니다: %w", err)
	}
	var list []Todo
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("할 일 파일이 깨졌습니다: %w", err)
	}
	return list, nil
}

// sameDay reports whether two times fall on the same local date.
func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Local().Date()
	by, bm, bd := b.Local().Date()
	return ay == by && am == bm && ad == bd
}

// today keeps what is still open and what was finished today; items
// finished on an earlier day have done their job and are dropped.
func today(list []Todo, now time.Time) []Todo {
	out := make([]Todo, 0, len(list))
	for _, t := range list {
		if t.Done && t.DoneAt != nil && !sameDay(*t.DoneAt, now) {
			continue
		}
		out = append(out, t)
	}
	return out
}

// editTodos reads the list, applies change and saves it, under one lock.
func (a *App) editTodos(workspaceID string, change func([]Todo) ([]Todo, error)) ([]Todo, error) {
	path, err := a.todoPath(workspaceID)
	if err != nil {
		return nil, err
	}
	a.todoMu.Lock()
	defer a.todoMu.Unlock()
	list, err := readTodos(path)
	if err != nil {
		return nil, err
	}
	list, err = change(today(list, a.now()))
	if err != nil {
		return nil, err
	}
	data, _ := json.MarshalIndent(list, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("할 일을 저장하지 못했습니다: %w", err)
	}
	if err := fsutil.WriteFileAtomic(path, data); err != nil {
		return nil, fmt.Errorf("할 일을 저장하지 못했습니다: %w", err)
	}
	return list, nil
}

// cleanTodoText makes one line of plain text (control characters become spaces).
func cleanTodoText(text string) (string, error) {
	text = strings.Join(strings.Fields(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, text)), " ")
	if text == "" {
		return "", errors.New("할 일 내용을 적어 주세요")
	}
	if utf8.RuneCountInString(text) > maxTodoRunes {
		return "", fmt.Errorf("할 일은 %d자 이내로 적어 주세요", maxTodoRunes)
	}
	return text, nil
}

func newTodoID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// AddTodo appends a to-do and returns the list.
func (a *App) AddTodo(workspaceID, text string) ([]Todo, error) {
	text, err := cleanTodoText(text)
	if err != nil {
		return nil, err
	}
	return a.editTodos(workspaceID, func(list []Todo) ([]Todo, error) {
		if len(list) >= maxTodos {
			return nil, fmt.Errorf("할 일은 %d개까지 적을 수 있습니다", maxTodos)
		}
		return append(list, Todo{ID: newTodoID(), Text: text, Created: a.now()}), nil
	})
}

// SetTodoDone checks or unchecks a to-do and returns the list.
func (a *App) SetTodoDone(workspaceID, id string, done bool) ([]Todo, error) {
	return a.editTodos(workspaceID, func(list []Todo) ([]Todo, error) {
		out := make([]Todo, len(list))
		found := false
		for i, t := range list {
			if t.ID == id {
				found = true
				t.Done, t.DoneAt = done, nil
				if done {
					at := a.now()
					t.DoneAt = &at
				}
			}
			out[i] = t
		}
		if !found {
			return nil, errors.New("그 할 일을 찾지 못했습니다")
		}
		return out, nil
	})
}

// DeleteTodo removes a to-do and returns the list.
func (a *App) DeleteTodo(workspaceID, id string) ([]Todo, error) {
	return a.editTodos(workspaceID, func(list []Todo) ([]Todo, error) {
		out := make([]Todo, 0, len(list))
		for _, t := range list {
			if t.ID != id {
				out = append(out, t)
			}
		}
		return out, nil
	})
}

func (a *App) todoData(workspaceID string) (TodoData, error) {
	path, err := a.todoPath(workspaceID)
	if err != nil {
		return TodoData{}, err
	}
	a.todoMu.Lock()
	defer a.todoMu.Unlock()
	list, err := readTodos(path)
	if err != nil {
		return TodoData{}, err
	}
	return TodoData{Items: today(list, a.now())}, nil
}
