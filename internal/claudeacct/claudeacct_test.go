package claudeacct

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const secretToken = "sk-ant-oat-SECRET"

func writeFiles(t *testing.T, expires time.Time) (credPath, cfgPath string) {
	t.Helper()
	dir := t.TempDir()
	credPath = filepath.Join(dir, ".credentials.json")
	cfgPath = filepath.Join(dir, ".claude.json")
	cred := map[string]any{"claudeAiOauth": map[string]any{
		"accessToken":      secretToken,
		"refreshToken":     "refresh-SECRET",
		"expiresAt":        expires.UnixMilli(),
		"subscriptionType": "team",
		"rateLimitTier":    "default_claude_max_5x",
		"scopes":           []string{"user:inference"},
	}}
	cfg := map[string]any{"oauthAccount": map[string]any{
		"emailAddress":     "me@example.com",
		"organizationName": "Acme",
		"organizationRole": "user",
		"billingType":      "stripe_subscription",
		"displayName":      "Me",
	}, "numStartups": 3}
	for path, v := range map[string]any{credPath: cred, cfgPath: cfg} {
		data, _ := json.Marshal(v)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return credPath, cfgPath
}

func TestLogin(t *testing.T) {
	expires := time.Now().Add(3 * time.Hour).Truncate(time.Millisecond)
	cred, cfg := writeFiles(t, expires)
	c := New(Options{CredentialsPath: cred, ConfigPath: cfg})

	got, err := c.Login()
	if err != nil {
		t.Fatal(err)
	}
	want := Login{
		Email: "me@example.com", Organization: "Acme", Role: "user", DisplayName: "Me",
		Billing: "stripe_subscription", Subscription: "team", RateLimitTier: "default_claude_max_5x",
		TokenExpiresAt: expires, LoggedIn: true,
	}
	if got != want {
		t.Fatalf("Login() = %+v\nwant %+v", got, want)
	}
	b, _ := json.Marshal(got)
	if strings.Contains(string(b), "SECRET") {
		t.Fatal("Login must never carry tokens")
	}
}

func TestLoginWhenLoggedOut(t *testing.T) {
	dir := t.TempDir()
	c := New(Options{CredentialsPath: filepath.Join(dir, "none.json"), ConfigPath: filepath.Join(dir, "none2.json")})
	got, err := c.Login()
	if err != nil || got.LoggedIn {
		t.Fatalf("Login() = %+v, %v; want logged out without error", got, err)
	}
}

func usageServer(t *testing.T, status int, body string, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/api/oauth/usage" || r.Header.Get("Authorization") != "Bearer "+secretToken ||
			r.Header.Get("anthropic-beta") != "oauth-2025-04-20" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestUsage(t *testing.T) {
	cred, cfg := writeFiles(t, time.Now().Add(time.Hour))
	var hits atomic.Int32
	srv := usageServer(t, 200, `{
		"five_hour": {"utilization": 72.4, "resets_at": "2026-10-23T14:00:00Z"},
		"seven_day": {"utilization": 38, "resets_at": "2026-10-28T00:00:00Z"},
		"seven_day_opus": null,
		"extra_usage": {"is_enabled": false}
	}`, &hits)
	c := New(Options{CredentialsPath: cred, ConfigPath: cfg, BaseURL: srv.URL, CacheFor: time.Minute})

	u, err := c.Usage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(u.Windows) != 2 {
		t.Fatalf("windows = %+v", u.Windows)
	}
	five := u.Windows[0]
	if five.Key != "five_hour" || five.Label != "5시간" || five.Percent != 72.4 ||
		!five.ResetsAt.Equal(time.Date(2026, 10, 23, 14, 0, 0, 0, time.UTC)) {
		t.Fatalf("five_hour = %+v", five)
	}
	if u.Windows[1].Key != "seven_day" {
		t.Fatalf("order = %+v", u.Windows)
	}

	// Cached: a second call does not hit the API.
	if _, err := c.Usage(context.Background()); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Fatalf("hits = %d, want 1 (cached)", hits.Load())
	}
}

func TestUsageErrors(t *testing.T) {
	var hits atomic.Int32
	t.Run("expired token is not sent", func(t *testing.T) {
		cred, cfg := writeFiles(t, time.Now().Add(-time.Minute))
		srv := usageServer(t, 200, `{}`, &hits)
		before := hits.Load()
		_, err := New(Options{CredentialsPath: cred, ConfigPath: cfg, BaseURL: srv.URL}).Usage(context.Background())
		if err == nil || !strings.Contains(err.Error(), "만료") {
			t.Fatalf("err = %v", err)
		}
		if hits.Load() != before {
			t.Fatal("an expired token must not be sent")
		}
	})
	t.Run("http error", func(t *testing.T) {
		cred, cfg := writeFiles(t, time.Now().Add(time.Hour))
		srv := usageServer(t, 429, `{"error":"rate"}`, &hits)
		_, err := New(Options{CredentialsPath: cred, ConfigPath: cfg, BaseURL: srv.URL}).Usage(context.Background())
		if err == nil || !strings.Contains(err.Error(), "429") {
			t.Fatalf("err = %v", err)
		}
		if strings.Contains(err.Error(), "SECRET") {
			t.Fatal("errors must not leak the token")
		}
	})
	t.Run("logged out", func(t *testing.T) {
		dir := t.TempDir()
		_, err := New(Options{CredentialsPath: filepath.Join(dir, "x"), ConfigPath: filepath.Join(dir, "y")}).Usage(context.Background())
		if err == nil || !strings.Contains(err.Error(), "로그인") {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestUsageDoesNotFollowRedirects(t *testing.T) {
	cred, cfg := writeFiles(t, time.Now().Add(time.Hour))
	var leaked atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			leaked.Store(true)
		}
	}))
	t.Cleanup(target.Close)
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/x", http.StatusFound)
	}))
	t.Cleanup(redirect.Close)
	_, err := New(Options{CredentialsPath: cred, ConfigPath: cfg, BaseURL: redirect.URL}).Usage(context.Background())
	if err == nil || leaked.Load() {
		t.Fatalf("err = %v, leaked = %v", err, leaked.Load())
	}
}

func TestUsageCachesErrorsBriefly(t *testing.T) {
	cred, cfg := writeFiles(t, time.Now().Add(time.Hour))
	var hits atomic.Int32
	srv := usageServer(t, 500, `{}`, &hits)
	c := New(Options{CredentialsPath: cred, ConfigPath: cfg, BaseURL: srv.URL})
	for range 3 {
		if _, err := c.Usage(context.Background()); err == nil {
			t.Fatal("expected error")
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("hits = %d, want 1 (error cached)", hits.Load())
	}
}
