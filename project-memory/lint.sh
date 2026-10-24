#!/bin/sh
# Checks the memory layout before a commit. The project-memory mod keeps this copy in step with its own.
cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
err() { echo "memory: $*" >&2; fail=1; }
size() { echo $(($(wc -c < "$1"))); }
# The lines between the opening and closing --- of a note, CRs dropped for Windows checkouts.
front() { tr -d '\r' < "$1" | awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit } NR > 1'; }
# A rule's paths, as a YAML list or on one line ([a, b] or a, b), quotes stripped.
paths_of() {
  front "$1" | awk '
    /^paths:/ { sub(/^paths:[ \t]*/, ""); gsub(/[][]/, ""); n = split($0, a, ","); for (i = 1; i <= n; i++) print a[i]; list = 1; next }
    list && /^[ \t]*-/ { sub(/^[ \t]*-[ \t]*/, ""); print; next }
    { list = 0 }' | sed "s/^[[:space:]]*//; s/[[:space:]]*\$//; s/^[\"']//; s/[\"']\$//" | grep -v '^$'
}

[ -f memory/MEMORY.md ] || { err "no memory/MEMORY.md"; exit 1; }
[ "$(size memory/MEMORY.md)" -le 2048 ] || err "memory/MEMORY.md is over 2KB. It loads every session, so keep it to one line per hub"

seen=" "
stale=""
for f in memory/*.md .claude/rules/memory/*.md; do
  [ -f "$f" ] && [ "$f" != memory/MEMORY.md ] || continue
  slug=$(basename "$f" .md)
  case $seen in *" $slug "*) err "$f: another note already uses the slug $slug" ;; esac
  seen="$seen$slug "
  fm=$(front "$f")
  echo "$fm" | grep -q '^name:' || err "$f: frontmatter has no name"
  echo "$fm" | grep -q '^description:' || err "$f: frontmatter has no description"
  status=$(echo "$fm" | sed -n 's/^status:[[:space:]]*//p')
  [ -z "$status" ] || [ "$status" = rejected ] || err "$f: status is '$status', and the only status is rejected"
  tr -d '\r' < "$f" | grep -q '^\*\*Why:\*\*' || err "$f: no **Why:** line"
  grep -rqF "[[$slug]]" memory/hubs 2>/dev/null || err "$f: no hub in memory/hubs lists [[$slug]]"
done

for f in .claude/rules/memory/*.md; do
  [ -f "$f" ] || continue
  [ "$(size "$f")" -le 1024 ] || err "$f: over 1KB. It loads whole whenever a matching file is touched, so move detail to a memory/ note and link it"
  pats=$(paths_of "$f")
  [ -n "$pats" ] || err "$f: no paths, so it never loads. Add paths or move it to memory/"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # ponytail: git pathspecs have no {a,b}, so brace patterns go unchecked. Expand them here if they get common.
    case $p in *'{'*) echo "memory: $f: can't check the brace pattern $p" >&2; continue ;; esac
    [ -n "$(git ls-files -- ":(glob)$p" | head -n 1)" ] || err "$f: $p matches no tracked file"
    # A note edited in this commit counts as checked.
    if [ -n "$(git diff --cached --name-only -- ":(glob)$p")" ] && git diff --cached --quiet -- "$f"; then
      case $stale in *"$f"*) ;; *) stale="$stale$f
" ;; esac
    fi
  done <<EOF
$pats
EOF
done

for h in memory/hubs/*.md; do
  [ -f "$h" ] || continue
  [ "$(size "$h")" -le 4096 ] || err "$h: over 4KB. Split the hub"
  grep -qF "(hubs/$(basename "$h"))" memory/MEMORY.md || err "$h: memory/MEMORY.md doesn't list it"
done
for l in $(tr -d '\r' < memory/MEMORY.md | grep -o '(hubs/[^)]*)' | tr -d '()'); do
  [ -f "memory/$l" ] || err "memory/MEMORY.md: memory/$l doesn't exist"
done

for f in memory/*.md memory/hubs/*.md .claude/rules/memory/*.md; do
  [ -f "$f" ] || continue
  links=$(tr -d '\r' < "$f" | grep -o '\[\[[^]]*\]\]' | sed 's/^\[\[//; s/\]\]$//; s/|.*//')
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    [ -f "memory/$l.md" ] || [ -f ".claude/rules/memory/$l.md" ] || err "$f: [[$l]] points to no note"
  done <<EOF
$links
EOF
done

if [ -n "$stale" ]; then
  echo "memory: this commit changes files these memories cover. Check they still hold:" >&2
  printf '%s' "$stale" | sed 's/^/  /' >&2
  echo "Claude: hand these files and \`git diff --cached\` to the project-memory:memory-keeper agent." >&2
fi
exit $fail
