# Solaris Claude Code Integration

This directory contains the Claude Code skill bundle for Solaris.

## User Flow

1. Open Solaris Settings > Integrations.
2. Add a Claude Agent.
3. Copy the full setup commands shown after the generated token.
4. Toggle the tools Claude is allowed to use.
5. Configure the terminal Claude Code session:

```bash
export SOLARIS_URL=http://your-solaris-host:7000
export SOLARIS_API_TOKEN=ody_generated_token
mkdir -p ~/.claude
curl -fsSL -H "Authorization: Bearer $SOLARIS_API_TOKEN" "$SOLARIS_URL/api/claude/plugin.zip" -o /tmp/solaris-claude-skill.zip
python3 -m zipfile -e /tmp/solaris-claude-skill.zip ~/.claude/
```

Claude Code auto-loads anything under `~/.claude/skills/`, so the `solaris` skill is
available in any session that has `SOLARIS_URL` and `SOLARIS_API_TOKEN` in its
environment.

## What's in the bundle

- `skills/solaris/SKILL.md` — the skill definition Claude Code reads.
- `skills/solaris/scripts/solaris_api.py` — small helper that calls the scoped
  `/api/codex/*` endpoints (these are the canonical scope-gated agent API; the
  `codex` path is historic and shared by all agent integrations).

## Scope enforcement

The token is scope-gated. Every tool surface is checked server-side in Solaris,
so even if Claude tries to call a forbidden endpoint, it gets `403` until the
user enables the matching toggle in Settings > Integrations > Claude Agent.
