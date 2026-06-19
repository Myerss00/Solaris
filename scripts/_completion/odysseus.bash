#!/usr/bin/env bash
# Tab-completion for the `solaris` umbrella + every `solaris-*` CLI.
#
# Source from your shell rc:
#     source /path/to/solaris-ui/scripts/_completion/solaris.bash
#
# Or wire it once per machine:
#     sudo install -m 644 solaris.bash /etc/bash_completion.d/solaris
#
# What it does:
#   - On the first word after `solaris`, complete with the list of
#     subcommands (`mail`, `calendar`, ...).
#   - On subsequent words, complete with the subcommand's first-token
#     subcommands (`list`, `show`, ...) which we cache by parsing the
#     tool's own --help output. Updates lazily; refresh by running
#     `_solaris_refresh_cache`.
#   - Same completion works for the individual `solaris-foo` scripts.

_solaris_scripts_dir() {
    # Resolve the scripts/ dir from the script that sources us. We assume
    # the user sourced the file directly out of scripts/_completion/.
    local self="${BASH_SOURCE[0]}"
    while [ -L "$self" ]; do self=$(readlink "$self"); done
    cd "$(dirname "$self")/.." && pwd
}

declare -A _SOLARIS_SUBS_CACHE=()

_solaris_refresh_cache() {
    local dir="$(_solaris_scripts_dir)"
    _SOLARIS_SUBS_CACHE=()
    # Prefer the project venv's Python so deps (bcrypt, sqlalchemy, ...)
    # resolve. Falls back to system `python3` for container installs.
    local py="$dir/../venv/bin/python"
    [ -x "$py" ] || py="$(command -v python3)"
    local f
    for f in "$dir"/solaris-*; do
        [ -x "$f" ] || continue
        case "$f" in *.bak|*.pyc|*.pre-*) continue ;; esac
        local name="$(basename "$f")"
        local sub="${name#solaris-}"
        local help_out
        help_out=$("$py" "$f" --help 2>/dev/null) || continue
        local commands
        commands=$(echo "$help_out" | grep -oE '\{[a-z0-9_,-]+\}' | head -1 \
            | tr -d '{}' | tr ',' ' ')
        _SOLARIS_SUBS_CACHE[$sub]="$commands"
    done
}

_solaris_complete() {
    [ ${#_SOLARIS_SUBS_CACHE[@]} -eq 0 ] && _solaris_refresh_cache

    local cur="${COMP_WORDS[COMP_CWORD]}"
    local cmd="${COMP_WORDS[0]}"

    # `solaris <tab>` → list every subcommand
    if [ "$cmd" = "solaris" ]; then
        if [ "$COMP_CWORD" -eq 1 ]; then
            local subs="${!_SOLARIS_SUBS_CACHE[@]} help"
            COMPREPLY=($(compgen -W "$subs" -- "$cur"))
            return 0
        fi
        # `solaris foo <tab>` — complete with foo's own subcommands
        local sub="${COMP_WORDS[1]}"
        # `solaris help <tab>` lists every subcommand
        if [ "$sub" = "help" ] && [ "$COMP_CWORD" -eq 2 ]; then
            COMPREPLY=($(compgen -W "${!_SOLARIS_SUBS_CACHE[*]}" -- "$cur"))
            return 0
        fi
        if [ "$COMP_CWORD" -eq 2 ]; then
            COMPREPLY=($(compgen -W "${_SOLARIS_SUBS_CACHE[$sub]}" -- "$cur"))
            return 0
        fi
        return 0
    fi

    # Direct `solaris-foo <tab>` (no umbrella)
    local sub="${cmd#solaris-}"
    if [ "$COMP_CWORD" -eq 1 ]; then
        COMPREPLY=($(compgen -W "${_SOLARIS_SUBS_CACHE[$sub]}" -- "$cur"))
        return 0
    fi
}

# Register the completion for every solaris-* script + the umbrella.
complete -F _solaris_complete solaris
for f in "$(_solaris_scripts_dir)"/solaris-*; do
    [ -x "$f" ] || continue
    case "$f" in *.bak|*.pyc|*.pre-*) continue ;; esac
    complete -F _solaris_complete "$(basename "$f")"
done
