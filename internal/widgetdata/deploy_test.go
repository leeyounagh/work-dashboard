package widgetdata

import "testing"

const deployJSON = `{"rows":[
 {"domain":"Shop","kind":"frontend","env":"prod","status":{"state":"pending","lagMs":518400000},
  "staging":{"pr":{"number":927,"title":"feat","url":"https://x/927"}},"live":{"pr":{"number":863,"title":"old","url":"https://x/863"}}},
 {"domain":"Shop","kind":"frontend","env":"test","status":{"state":"pending","lagMs":43200000},"staging":{"pr":null},"live":null},
 {"domain":"Admin","kind":"frontend","env":"prod","status":{"state":"synced"},"staging":null,"live":null},
 {"domain":"Billing","kind":"backend","env":"prod","unsupported":"HTTP 403","status":{"state":"opaque"}}
]}`

func TestBuildDeployFromJSON(t *testing.T) {
	d := BuildDeploy(deployJSON, 0, Settings{"staleDays": 1})
	if d.Pending != 2 || d.Unknown != 1 || len(d.Rows) != 3 {
		t.Fatalf("d = %+v", d)
	}
	first := d.Rows[0]
	if first.Name != "Shop frontend prod" || first.WaitingDays != 6 || !first.Stale || first.Staging.Number != 927 || first.Live.Number != 863 {
		t.Fatalf("first = %+v", first)
	}
	if d.Rows[1].Stale || d.Rows[1].WaitingDays != 0.5 || d.Rows[1].Staging != nil {
		t.Fatalf("second = %+v", d.Rows[1])
	}
	if d.Rows[2].State != "synced" {
		t.Fatalf("third = %+v", d.Rows[2])
	}
}

func TestBuildDeployFallsBackToText(t *testing.T) {
	d := BuildDeploy("plain table output", 2, Settings{})
	if d.Text != "plain table output" || d.ExitCode != 2 || len(d.Rows) != 0 {
		t.Fatalf("d = %+v", d)
	}
}
