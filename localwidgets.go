package main

import (
	"context"

	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
)

// PlannedData marks a widget whose data source is not wired up yet.
type PlannedData struct {
	Planned bool   `json:"planned"`
	Message string `json:"message"`
}

// buildLocalWidget handles widgets backed by local tools and Claude connectors.
func (a *App) buildLocalWidget(_ context.Context, typ string, _ widgetdata.Settings, _ bool) (any, error) {
	return PlannedData{Planned: true, Message: typ + " 위젯은 다음 단계에서 연결됩니다"}, nil
}
