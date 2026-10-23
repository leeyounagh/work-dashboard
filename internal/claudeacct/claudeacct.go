// Package claudeacct reads the Claude Code login on this machine and its
// usage limits. Tokens are read from the local credentials file only to call
// the usage endpoint; they are never returned to callers.
package claudeacct

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Options configures where to read from; zero values use the defaults.
type Options struct {
	CredentialsPath string // ~/.claude/.credentials.json
	ConfigPath      string // ~/.claude.json
	BaseURL         string // https://api.anthropic.com
	CacheFor        time.Duration
	HTTPClient      *http.Client
}

// Client reads login information and usage.
type Client struct {
	opt Options

	mu       sync.Mutex
	cached   Usage
	cachedAt time.Time
}

// New creates a client.
func New(opt Options) *Client {
	home, _ := os.UserHomeDir()
	if opt.CredentialsPath == "" {
		opt.CredentialsPath = filepath.Join(home, ".claude", ".credentials.json")
	}
	if opt.ConfigPath == "" {
		opt.ConfigPath = filepath.Join(home, ".claude.json")
	}
	if opt.BaseURL == "" {
		opt.BaseURL = "https://api.anthropic.com"
	}
	if opt.CacheFor == 0 {
		opt.CacheFor = time.Minute
	}
	if opt.HTTPClient == nil {
		opt.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{opt: opt}
}

// Login is what the dashboard shows about the signed-in account. No secrets.
type Login struct {
	LoggedIn       bool      `json:"loggedIn"`
	Email          string    `json:"email"`
	DisplayName    string    `json:"displayName"`
	Organization   string    `json:"organization"`
	Role           string    `json:"role"`
	Billing        string    `json:"billing"`
	Subscription   string    `json:"subscription"`
	RateLimitTier  string    `json:"rateLimitTier"`
	TokenExpiresAt time.Time `json:"tokenExpiresAt"`
}

type oauthCreds struct {
	AccessToken      string `json:"accessToken"`
	ExpiresAt        int64  `json:"expiresAt"` // unix ms
	SubscriptionType string `json:"subscriptionType"`
	RateLimitTier    string `json:"rateLimitTier"`
}

func readJSON(path string, v any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return true, nil
}

func (c *Client) creds() (oauthCreds, bool, error) {
	var f struct {
		ClaudeAiOauth *oauthCreds `json:"claudeAiOauth"`
	}
	ok, err := readJSON(c.opt.CredentialsPath, &f)
	if err != nil || !ok || f.ClaudeAiOauth == nil || f.ClaudeAiOauth.AccessToken == "" {
		return oauthCreds{}, false, err
	}
	return *f.ClaudeAiOauth, true, nil
}

// Login reads the account details. A missing login is not an error.
func (c *Client) Login() (Login, error) {
	cr, ok, err := c.creds()
	if err != nil {
		return Login{}, fmt.Errorf("Claude 로그인 정보를 읽지 못했습니다: %w", err)
	}
	if !ok {
		return Login{}, nil
	}
	var cfg struct {
		OAuthAccount struct {
			EmailAddress     string `json:"emailAddress"`
			DisplayName      string `json:"displayName"`
			OrganizationName string `json:"organizationName"`
			OrganizationRole string `json:"organizationRole"`
			BillingType      string `json:"billingType"`
		} `json:"oauthAccount"`
	}
	if _, err := readJSON(c.opt.ConfigPath, &cfg); err != nil {
		return Login{}, fmt.Errorf("Claude 계정 정보를 읽지 못했습니다: %w", err)
	}
	a := cfg.OAuthAccount
	return Login{
		LoggedIn:       true,
		Email:          a.EmailAddress,
		DisplayName:    a.DisplayName,
		Organization:   a.OrganizationName,
		Role:           a.OrganizationRole,
		Billing:        a.BillingType,
		Subscription:   cr.SubscriptionType,
		RateLimitTier:  cr.RateLimitTier,
		TokenExpiresAt: time.UnixMilli(cr.ExpiresAt),
	}, nil
}

// Window is one usage limit, e.g. the rolling 5-hour window.
type Window struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Percent  float64   `json:"percent"`
	ResetsAt time.Time `json:"resetsAt"`
}

// Usage is the current usage across limit windows.
type Usage struct {
	Windows   []Window  `json:"windows"`
	FetchedAt time.Time `json:"fetchedAt"`
}

var windowLabels = map[string]string{
	"five_hour":            "5시간",
	"seven_day":            "7일",
	"seven_day_opus":       "7일 · Opus",
	"seven_day_sonnet":     "7일 · Sonnet",
	"seven_day_oauth_apps": "7일 · 연동 앱",
}

var windowOrder = map[string]int{"five_hour": 0, "seven_day": 1}

// Usage returns usage limits, cached for Options.CacheFor.
func (c *Client) Usage(ctx context.Context) (Usage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.cachedAt.IsZero() && time.Since(c.cachedAt) < c.opt.CacheFor {
		return c.cached, nil
	}
	u, err := c.fetchUsage(ctx)
	if err != nil {
		return Usage{}, err
	}
	c.cached, c.cachedAt = u, time.Now()
	return u, nil
}

func (c *Client) fetchUsage(ctx context.Context) (Usage, error) {
	cr, ok, err := c.creds()
	if err != nil {
		return Usage{}, fmt.Errorf("Claude 로그인 정보를 읽지 못했습니다: %w", err)
	}
	if !ok {
		return Usage{}, errors.New("Claude Code 에 로그인돼 있지 않습니다")
	}
	if cr.ExpiresAt != 0 && time.Now().After(time.UnixMilli(cr.ExpiresAt)) {
		// Claude Code refreshes the token itself; we never use the refresh token.
		return Usage{}, errors.New("로그인 토큰이 만료됐습니다. Claude Code 를 한 번 실행하면 갱신됩니다")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.opt.BaseURL+"/api/oauth/usage", nil)
	if err != nil {
		return Usage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+cr.AccessToken)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	req.Header.Set("User-Agent", "work-dashboard")
	res, err := c.opt.HTTPClient.Do(req)
	if err != nil {
		return Usage{}, fmt.Errorf("사용량을 가져오지 못했습니다: %w", err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return Usage{}, fmt.Errorf("사용량 응답을 읽지 못했습니다: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		return Usage{}, fmt.Errorf("사용량 API 가 HTTP %d 를 돌려줬습니다", res.StatusCode)
	}
	return parseUsage(body)
}

func parseUsage(body []byte) (Usage, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return Usage{}, fmt.Errorf("사용량 응답 형식이 바뀌었습니다: %w", err)
	}
	u := Usage{FetchedAt: time.Now()}
	for key, msg := range raw {
		var w struct {
			Utilization *float64 `json:"utilization"`
			ResetsAt    string   `json:"resets_at"`
		}
		if json.Unmarshal(msg, &w) != nil || w.Utilization == nil {
			continue // null windows and unrelated fields
		}
		label := windowLabels[key]
		if label == "" {
			label = key
		}
		resets, _ := time.Parse(time.RFC3339, w.ResetsAt)
		u.Windows = append(u.Windows, Window{Key: key, Label: label, Percent: *w.Utilization, ResetsAt: resets})
	}
	sort.Slice(u.Windows, func(i, j int) bool {
		oi, iok := windowOrder[u.Windows[i].Key]
		oj, jok := windowOrder[u.Windows[j].Key]
		if iok != jok {
			return iok
		}
		if iok && oi != oj {
			return oi < oj
		}
		return u.Windows[i].Key < u.Windows[j].Key
	})
	return u, nil
}
