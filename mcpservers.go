package main

import (
	"context"
	"log"
	"slices"
	"sync"
	"time"
)

// mcpListFor is how long the MCP server list is reused; a failed listing is
// retried after mcpRetryFor.
const (
	mcpListFor  = time.Hour
	mcpRetryFor = 5 * time.Minute
	mcpListWait = 30 * time.Second
)

type mcpCache struct {
	mu      sync.Mutex
	servers []string
	at      time.Time
	ok      bool
}

// mcpServers returns the user's MCP servers as tool prefixes, or nil when
// they are unknown (then lookups simply hide nothing).
func (a *App) mcpServers(ctx context.Context) []string {
	if a.deps.MCPServers == nil {
		return nil
	}
	c := &a.mcp
	c.mu.Lock()
	defer c.mu.Unlock()
	fresh := mcpListFor
	if !c.ok {
		fresh = mcpRetryFor
	}
	if !c.at.IsZero() && time.Since(c.at) < fresh {
		return slices.Clone(c.servers)
	}
	ctx, cancel := context.WithTimeout(ctx, mcpListWait)
	defer cancel()
	servers, err := a.deps.MCPServers(ctx)
	if err != nil {
		log.Printf("listing MCP servers: %v", err)
	}
	c.servers, c.at, c.ok = servers, time.Now(), err == nil
	return slices.Clone(servers)
}
