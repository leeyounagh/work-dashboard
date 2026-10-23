package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

const (
	maxOpenFiles        = 50
	serverVersion       = "0.1.0"
	defaultProtoVersion = "2025-06-18"
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// supportedVersions are MCP protocol versions whose request/response shapes
// this server implements (JSON responses, tools only).
var supportedVersions = map[string]bool{"2024-11-05": true, "2025-03-26": true, "2025-06-18": true}

var openFilesTool = map[string]any{
	"name": "open_files",
	"description": "Show files to the user in the work-dashboard file tree and viewer. " +
		"Call this when the user asks you to open, show or bring up code (e.g. \"코드 열어줘\"). " +
		"Use absolute paths, or paths relative to the session's working directory.",
	"inputSchema": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"paths": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"maxItems":    maxOpenFiles,
				"description": "Files to open.",
			},
		},
		"required": []string{"paths"},
	},
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) serveMCP(w http.ResponseWriter, r *http.Request, session string) {
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		writeJSON(w, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
		return
	}
	if len(req.ID) == 0 {
		// Notifications (e.g. notifications/initialized) get no response body.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		// Answer with the client's version only if we support it (MCP spec).
		if !supportedVersions[p.ProtocolVersion] {
			p.ProtocolVersion = defaultProtoVersion
		}
		resp.Result = map[string]any{
			"protocolVersion": p.ProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "work-dashboard", "version": serverVersion},
		}
	case "ping":
		resp.Result = map[string]any{}
	case "tools/list":
		resp.Result = map[string]any{"tools": []any{openFilesTool}}
	case "tools/call":
		result, err := s.callTool(session, req.Params)
		if err != nil {
			resp.Error = &rpcError{-32602, err.Error()}
		} else {
			resp.Result = result
		}
	default:
		resp.Error = &rpcError{-32601, "method not found: " + req.Method}
	}
	writeJSON(w, resp)
}

func toolText(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []any{map[string]any{"type": "text", "text": text}},
		"isError": isError,
	}
}

// callTool returns a protocol error for malformed calls and a tool result
// (with isError) when the call was understood but could not be completed.
func (s *Server) callTool(session string, raw json.RawMessage) (map[string]any, error) {
	var p struct {
		Name      string `json:"name"`
		Arguments struct {
			Paths []string `json:"paths"`
		} `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Name != "open_files" {
		return nil, fmt.Errorf("unknown tool %q", p.Name)
	}
	paths := p.Arguments.Paths
	if len(paths) == 0 {
		return nil, errors.New("paths is required")
	}
	if len(paths) > maxOpenFiles {
		return nil, fmt.Errorf("at most %d paths per call", maxOpenFiles)
	}
	if s.h.OnOpenFiles == nil {
		return toolText("the dashboard cannot open files right now", true), nil
	}
	opened, err := s.h.OnOpenFiles(session, paths)
	if err != nil {
		return toolText("Could not open: "+err.Error(), true), nil
	}
	return toolText(fmt.Sprintf("Opened %d file(s) in the dashboard:\n%s", len(opened), strings.Join(opened, "\n")), false), nil
}
