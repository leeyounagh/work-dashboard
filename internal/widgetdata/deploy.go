package widgetdata

import (
	"encoding/json"
	"sort"
)

// DeployRow is one app slot from a deploy-status style report.
type DeployRow struct {
	Name        string  `json:"name"` // "Groupware frontend test"
	State       string  `json:"state"`
	WaitingDays float64 `json:"waitingDays"`
	Stale       bool    `json:"stale"`
	Staging     *PRLink `json:"staging,omitempty"`
	Live        *PRLink `json:"live,omitempty"`
	Note        string  `json:"note,omitempty"`
}

// PRLink is a PR deployed somewhere.
type PRLink struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
}

// DeployData feeds the deploy widget: structured rows when the command
// prints deploy-status JSON, otherwise its text.
type DeployData struct {
	Rows     []DeployRow `json:"rows"`
	Pending  int         `json:"pending"`
	Unknown  int         `json:"unknown"`
	Text     string      `json:"text,omitempty"`
	ExitCode int         `json:"exitCode"`
	// Truncated: the command printed more than the widget keeps.
	Truncated bool `json:"truncated,omitempty"`
}

type deploySlot struct {
	PR *PRLink `json:"pr"`
}

type deployReport struct {
	Rows []struct {
		Domain      string      `json:"domain"`
		Kind        string      `json:"kind"`
		Env         string      `json:"env"`
		Unsupported string      `json:"unsupported"`
		Live        *deploySlot `json:"live"`
		Staging     *deploySlot `json:"staging"`
		Status      struct {
			State string  `json:"state"`
			LagMs float64 `json:"lagMs"`
		} `json:"status"`
	} `json:"rows"`
}

// BuildDeploy turns command output into widget data. Pending swaps waiting
// at least staleDays are flagged; rows that could not be checked are counted.
func BuildDeploy(stdout string, exitCode int, s Settings) DeployData {
	staleDays := float64(s.Int("staleDays", 1))
	d := DeployData{Rows: []DeployRow{}, ExitCode: exitCode}
	var rep deployReport
	if err := json.Unmarshal([]byte(stdout), &rep); err != nil || rep.Rows == nil {
		d.Text = stdout
		return d
	}
	for _, r := range rep.Rows {
		if r.Status.State == "opaque" || r.Unsupported != "" && r.Status.State == "" {
			d.Unknown++
			continue
		}
		row := DeployRow{Name: r.Domain + " " + r.Kind + " " + r.Env, State: r.Status.State, Note: r.Unsupported}
		if r.Staging != nil {
			row.Staging = r.Staging.PR
		}
		if r.Live != nil {
			row.Live = r.Live.PR
		}
		if r.Status.State == "pending" {
			d.Pending++
			row.WaitingDays = r.Status.LagMs / 86_400_000
			row.Stale = row.WaitingDays >= staleDays
		}
		d.Rows = append(d.Rows, row)
	}
	// Pending (longest wait first), then everything else by name.
	sort.SliceStable(d.Rows, func(i, j int) bool {
		a, b := d.Rows[i], d.Rows[j]
		if (a.State == "pending") != (b.State == "pending") {
			return a.State == "pending"
		}
		if a.WaitingDays != b.WaitingDays {
			return a.WaitingDays > b.WaitingDays
		}
		return a.Name < b.Name
	})
	return d
}
