#!/usr/bin/env bash
# Codebase-memory prompt gate for FluxyOS.
#
# When a prompt asks to BUILD or CHANGE something (new feature, refactor,
# improvement, bug fix), inject a reminder to query the codebase knowledge
# graph before grepping around. The graph is indexed at
# ~/.local/bin/codebase-memory-mcp and covers assets/js, functions/,
# netlify/, scripts/, tests/, and the root HTML pages.
#
# Non-blocking by design: this is a UserPromptSubmit hook that only adds
# context. It never rejects a prompt. Compare qa-gate.sh / docs-read-gate.sh,
# which are PreToolUse gates that DO block.
#
# Input on stdin (JSON): { "prompt": "...", ... }
# Output: JSON with hookSpecificOutput.additionalContext, or nothing.
# Exit code is always 0.

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' | tr '[:upper:]' '[:lower:]')

[ -z "$PROMPT" ] && exit 0

# Build/change intent, English + Bahasa Indonesia (this is a Bahasa-first
# project, so the prompt may arrive in either language).
BUILD_INTENT='feature|implement|refactor|improve|enhance|redesign|rework|optimi[sz]e|add |build |create |rewrite|migrate|extend'
BUILD_INTENT_ID='fitur|buat |tambah|perbaiki|ubah |tingkatkan|ganti |bikin '

if ! printf '%s' "$PROMPT" | grep -qE "$BUILD_INTENT|$BUILD_INTENT_ID"; then
  exit 0
fi

jq -n '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: (
      "FluxyOS codebase-memory: this prompt looks like build/change work. " +
      "Before broad Grep/Glob sweeps, query the indexed knowledge graph " +
      "(project name: \"Users-jay-Desktop-fluxyos\") via the codebase-memory-mcp " +
      "MCP tools — search_graph to locate code, trace_path / query_graph for " +
      "callers and impact, get_architecture for structure. Fall back to " +
      "Grep/Read when the graph does not answer the question. " +
      "This does not replace the CLAUDE.md pre-implementation doc reads " +
      "(PROJECT_BACKGROUND.md + DESIGN_SYSTEM.md), which are still gated."
    )
  }
}'

exit 0
