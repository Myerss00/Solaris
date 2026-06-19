#compdef solaris solaris-backup solaris-calendar solaris-contacts solaris-cookbook solaris-docs solaris-gallery solaris-mail solaris-mcp solaris-memory solaris-notes solaris-personal solaris-preset solaris-research solaris-sessions solaris-signature solaris-skills solaris-tasks solaris-theme solaris-webhook
# Zsh tab-completion for the solaris umbrella + sub-CLIs.
#
# Drop in any directory on $fpath, e.g.:
#     fpath=(/path/to/solaris-ui/scripts/_completion $fpath)
#     autoload -U compinit; compinit
#
# Then `solaris <tab>` completes subcommands; `solaris mail <tab>`
# completes mail subcommands; `solaris-mail <tab>` works the same.

_solaris_scripts_dir() {
    local self="${(%):-%x}"
    while [[ -L "$self" ]]; do self="$(readlink "$self")"; done
    cd "${self:h}/.." && pwd
}

typeset -gA _solaris_subs

_solaris_refresh() {
    _solaris_subs=()
    local dir="$(_solaris_scripts_dir)"
    local py="$dir/../venv/bin/python"
    [[ -x "$py" ]] || py="$(command -v python3)"
    local f sub help_out commands
    for f in "$dir"/solaris-*; do
        [[ -x "$f" ]] || continue
        case "$f" in
            *.bak|*.pyc|*.pre-*) continue ;;
        esac
        sub="${${f:t}#solaris-}"
        help_out=$("$py" "$f" --help 2>/dev/null) || continue
        commands=$(echo "$help_out" | grep -oE '\{[a-z0-9_,-]+\}' | head -1 \
            | tr -d '{}' | tr ',' ' ')
        _solaris_subs[$sub]="$commands"
    done
}

_solaris() {
    [[ ${#_solaris_subs} -eq 0 ]] && _solaris_refresh

    local cmd="${words[1]}"

    if [[ "$cmd" == "solaris" ]]; then
        if (( CURRENT == 2 )); then
            local -a subs=(${(k)_solaris_subs} help)
            _describe 'subcommand' subs
            return
        fi
        local sub="${words[2]}"
        if [[ "$sub" == "help" ]] && (( CURRENT == 3 )); then
            local -a subs=(${(k)_solaris_subs})
            _describe 'subcommand' subs
            return
        fi
        if (( CURRENT == 3 )); then
            local -a sc=(${(s/ /)_solaris_subs[$sub]})
            _describe 'command' sc
            return
        fi
        return
    fi

    # solaris-foo <tab>
    local sub="${cmd#solaris-}"
    if (( CURRENT == 2 )); then
        local -a sc=(${(s/ /)_solaris_subs[$sub]})
        _describe 'command' sc
        return
    fi
}

_solaris "$@"
