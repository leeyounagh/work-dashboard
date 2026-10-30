package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/claudeask"
	"github.com/leeyounagh/work-dashboard/internal/teamsdeploy"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/widgetdata"
)

// The Microsoft 365 connector's generic reader; the chat is named in the prompt.
var (
	teamsReadTools  = []string{"mcp__claude_ai_Microsoft_365__read_resource"}
	teamsWriteTools = []string{
		"mcp__claude_ai_Microsoft_365__teams_send_chat_message",
		"mcp__claude_ai_Microsoft_365__teams_send_channel_message",
		"mcp__claude_ai_Microsoft_365__outlook_send_email",
	}
)

// teamsBudgetUSD: the first read of a chat goes through a day of cards
// (about $0.35 for 18 cards); later reads only see new ones.
const teamsBudgetUSD = 0.6

var teamsSchema = json.RawMessage(`{"type":"object","properties":{"connectorAvailable":{"type":"boolean"},
"cards":{"type":"array","items":{"type":"object","properties":{
"id":{"type":"string"},"createdAt":{"type":"string"},"webUrl":{"type":"string"},"title":{"type":"string"},
"repo":{"type":"string"},"image":{"type":"string"},
"prs":{"type":"array","items":{"type":"object","properties":{"number":{"type":"integer"},"title":{"type":"string"},
"author":{"type":"string"},"shared":{"type":"boolean"}},"required":["number","title"]}}},
"required":["id","createdAt","title"]}}},"required":["connectorAvailable","cards"]}`)

// TeamsDeployData feeds the Teams deploy notifications widget.
type TeamsDeployData struct {
	Cards     []teamsdeploy.Card `json:"cards"`
	Tags      []string           `json:"tags"`
	Me        string             `json:"me"`
	FetchedAt time.Time          `json:"fetchedAt"`
	CostUSD   float64            `json:"costUsd"`
}

// teamsFeed is one chat's cards, shared by every widget that shows that chat.
type teamsFeed struct {
	cards     []teamsdeploy.Card
	fetchedAt time.Time
	costUSD   float64
}

// teamsMaxReads caps the messages one read opens, so a busy day cannot run
// a read over its budget again and again (nothing is stored when it fails).
const teamsMaxReads = 20

func teamsPrompt(chatID string, since time.Time, known []string) string {
	skip := ""
	if len(known) > 0 {
		skip = " except the ids " + strings.Join(known, ", ")
	}
	return "Using the Microsoft 365 read_resource tool: 1) read teams:///chats/" + chatID + "/messages to list the chat's" +
		" messages. 2) For every message with messageType \"message\" created at or after " +
		since.UTC().Format(time.RFC3339Nano) + skip + ", read it by its uri: at most " + strconv.Itoa(teamsMaxReads) +
		" messages, the newest first. Each holds an adaptive card. Report per card: id, createdAt, webUrl, title (the first large" +
		" TextBlock, verbatim), repo (like \"aoroa-space/neohelios-frontend\", without the branch), image (the version in" +
		" backticks after 이미지, without backticks, else empty), and prs: every \"- [#N](url) title · author\" bullet as" +
		" number, title, author, with shared true for bullets after the note about shared code redeployed together." +
		" Return no cards if there are none. Read nothing else. Set connectorAvailable to false if the tool is not" +
		" available. Do not send or change anything."
}

func (a *App) teamsDeploy(_ context.Context, s widgetdata.Settings, fresh bool) (any, error) {
	link := s.String("chat", "")
	if link == "" {
		return nil, needsSetup{"「설정」에 Teams 채팅방 링크(채팅방 「링크 복사」)를 넣으면 보입니다"}
	}
	chatID, err := teamsdeploy.ChatID(link)
	if err != nil {
		return nil, err
	}
	tags := s.Strings("tags")
	if err := teamsdeploy.CheckTags(tags); err != nil {
		return nil, err
	}
	// Keyed by chat only: workspaces showing other services share one read.
	// The read runs on its own clock: every widget showing the chat waits on it.
	v, err := a.cachedAsk("teams:"+chatID, fresh, func() (any, error) {
		ctx, cancel := context.WithTimeout(a.life, widgetTimeout(widget.TeamsDeploy))
		defer cancel()
		return a.readTeams(ctx, chatID)
	})
	if err != nil {
		return nil, err
	}
	feed := v.(teamsFeed)
	if tags == nil {
		tags = []string{}
	}
	return TeamsDeployData{
		Cards: teamsdeploy.Filter(feed.cards, tags, s.Int("limit", 8)), Tags: tags, Me: s.String("me", ""),
		FetchedAt: feed.fetchedAt, CostUSD: feed.costUSD,
	}, nil
}

// readTeams reads the cards posted since the newest one already stored.
func (a *App) readTeams(ctx context.Context, chatID string) (teamsFeed, error) {
	sum := sha256.Sum256([]byte(chatID))
	path := filepath.Join(filepath.Dir(a.deps.RunDir), "teams", hex.EncodeToString(sum[:8])+".json")
	store, err := teamsdeploy.Load(path)
	if err != nil {
		log.Printf("teams: %v; reading again", err)
	}
	now := time.Now()
	since := store.Since(now)
	var out struct {
		ConnectorAvailable bool              `json:"connectorAvailable"`
		Cards              []teamsdeploy.Raw `json:"cards"`
	}
	cost, err := a.ask(ctx, claudeask.Request{
		Prompt: teamsPrompt(chatID, since, store.Known(since)), Schema: teamsSchema, MaxBudgetUSD: teamsBudgetUSD,
		AllowedTools: teamsReadTools, DisallowedTools: append(append([]string{}, teamsWriteTools...), connectorWriteTools...),
	}, &out)
	if err != nil {
		return teamsFeed{}, err
	}
	if !out.ConnectorAvailable {
		return teamsFeed{}, errNoConnector
	}
	cards := make([]teamsdeploy.Card, 0, len(out.Cards))
	for _, r := range out.Cards {
		if c, ok := teamsdeploy.FromRaw(r, now); ok {
			cards = append(cards, c)
		}
	}
	store = store.Merge(cards, now)
	if err := store.Save(path); err != nil {
		log.Printf("teams: saving cards: %v", err)
	}
	return teamsFeed{cards: store.Cards, fetchedAt: now, costUSD: cost}, nil
}
