#!/bin/sh
# Checks the memory layout before a commit. The project-memory mod keeps this copy in step with its own.
# One awk pass does every check, since a process per note or per glob takes minutes on Windows.
cd "$(git rev-parse --show-toplevel)" || exit 1

[ -f memory/MEMORY.md ] || { echo "memory: no memory/MEMORY.md" >&2; exit 1; }

set --
for f in memory/hubs/*.md memory/*.md .claude/rules/memory/*.md; do
  [ -f "$f" ] && set -- "$@" "$f"
done

# stdin carries the tracked files, then the staged files, then the byte counts, split by lines holding only /.
{
  git -c core.quotePath=false ls-files
  echo /
  git -c core.quotePath=false diff --cached --name-only
  echo /
  wc -c "$@"
} | LC_ALL=C awk '
function err(m) { print "memory: " m; fail = 1 }
function base(f) { sub(/.*\//, "", f); sub(/\.md$/, "", f); return f }
function isnote(f) { return f != "memory/MEMORY.md" && (f ~ /^memory\/[^\/]*$/ || f ~ /^\.claude\/rules\/memory\//) }
# A rule path, quotes and spaces stripped.
function addpath(f, s) {
  gsub(/^[ \t]+|[ \t]+$/, "", s); sub(/^["\047]/, "", s); sub(/["\047]$/, "", s)
  if (s != "") pth[f, ++np[f]] = s
}
# An inline paths list, split on the commas outside {a,b}.
function addpaths(f, s,   i, c, d, t) {
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "{") d++
    else if (c == "}" && d) d--
    if (c == "," && !d) { addpath(f, t); t = "" } else t = t c
  }
  addpath(f, t)
}
# A git :(glob) pattern as a regex: ** crosses folders, * and ? stay inside one, {a,b} picks one.
function glob2re(g,   re, i, j, c, s, br) {
  re = "^"
  for (i = 1; i <= length(g); i++) {
    c = substr(g, i, 1)
    if (substr(g, i, 3) == "**/") { re = re "(.*/)?"; i += 2 }
    else if (substr(g, i, 2) == "**") { re = re ".*"; i++ }
    else if (c == "*") re = re "[^/]*"
    else if (c == "?") re = re "[^/]"
    else if (c == "[" && (j = index(substr(g, i + 1), "]"))) { s = substr(g, i + 1, j - 1); sub(/^!/, "^", s); re = re "[" s "]"; i += j }
    else if (c == "{") { re = re "("; br++ }
    else if (c == "}" && br) { re = re ")"; br-- }
    else if (c == "," && br) re = re "|"
    else if (index("\\^$.|+()[]{}", c)) re = re "\\" c
    else re = re c
  }
  # A { left open would make the regex invalid and kill awk.
  while (br-- > 0) re = re ")"
  return re "$"
}
function matches(p, list, n,   re, pre, i) {
  re = glob2re(p); pre = p
  if (match(p, /[*?[{]/)) pre = substr(p, 1, RSTART - 1)
  for (i = 1; i <= n; i++) if (index(list[i], pre) == 1 && list[i] ~ re) return 1
  return 0
}

FNR == 1 { fileno++ }
fileno == 1 {
  if ($0 == "/") sec++
  else if (sec == 0) tracked[++nt] = $0
  else if (sec == 1) { staged[++ns] = $0; isstaged[$0] = 1 }
  else { p = $0; sub(/^ *[0-9]+ /, "", p); bytes[p] = $1 + 0 }
  next
}
{ sub(/\r$/, "") }
FNR == 1 { f = FILENAME; order[++nf] = f; exists[f] = 1; infm = 0; list = 0; if ($0 == "---") { infm = 1; next } }
infm && $0 == "---" { infm = 0; next }
infm {
  if (/^name:/) named[f] = 1
  if (/^description:/) described[f] = 1
  if (/^status:/) { s = $0; sub(/^status:[ \t]*/, "", s); status[f] = s }
  if (list && /^[ \t]*-/) { s = $0; sub(/^[ \t]*-[ \t]*/, "", s); addpath(f, s) }
  else {
    list = 0
    if (/^paths:/) { s = $0; sub(/^paths:[ \t]*\[?/, "", s); sub(/\][ \t]*$/, "", s); addpaths(f, s); list = 1 }
  }
}
/^\*\*Why:\*\*/ { why[f] = 1 }
{ s = $0; while (match(s, /\[\[[^]]*\]\]/)) { l = substr(s, RSTART + 2, RLENGTH - 4); sub(/\|.*/, "", l); lfile[++nl] = f; link[nl] = l; s = substr(s, RSTART + RLENGTH) } }
f == "memory/MEMORY.md" { s = $0; while (match(s, /\(hubs\/[^)]*\)/)) { h = substr(s, RSTART + 1, RLENGTH - 2); hubref[++nh] = h; listedhub[h] = 1; s = substr(s, RSTART + RLENGTH) } }

END {
  if (bytes["memory/MEMORY.md"] > 2048) err("memory/MEMORY.md is over 2KB. It loads every session, so keep it to one line per hub")
  for (i = 1; i <= nl; i++) if (lfile[i] ~ /^memory\/hubs\//) inhub[link[i]] = 1

  for (k = 1; k <= nf; k++) {
    f = order[k]
    if (!isnote(f)) continue
    slug = base(f)
    if (slug in seen) err(f ": another note already uses the slug " slug)
    seen[slug] = 1
    if (!named[f]) err(f ": frontmatter has no name")
    if (!described[f]) err(f ": frontmatter has no description")
    if (status[f] != "" && status[f] != "rejected") err(f ": status is \047" status[f] "\047, and the only status is rejected")
    if (!why[f]) err(f ": no **Why:** line")
    if (!(slug in inhub)) err(f ": no hub in memory/hubs lists [[" slug "]]")
  }

  for (k = 1; k <= nf; k++) {
    f = order[k]
    if (f !~ /^\.claude\/rules\/memory\//) continue
    if (bytes[f] > 1024) err(f ": over 1KB. It loads whole whenever a matching file is touched, so move detail to a memory/ note and link it")
    if (!np[f]) err(f ": no paths, so it never loads. Add paths or move it to memory/")
    for (j = 1; j <= np[f]; j++) {
      if (!matches(pth[f, j], tracked, nt)) err(f ": " pth[f, j] " matches no tracked file")
      # A note edited in this commit counts as checked.
      if (!(f in isstaged) && !(f in stale) && matches(pth[f, j], staged, ns)) { stale[f] = 1; stalelist[++nst] = f }
    }
  }

  for (k = 1; k <= nf; k++) {
    f = order[k]
    if (f !~ /^memory\/hubs\//) continue
    if (bytes[f] > 4096) err(f ": over 4KB. Split the hub")
    if (!(("hubs/" base(f) ".md") in listedhub)) err(f ": memory/MEMORY.md doesn\047t list it")
  }
  for (i = 1; i <= nh; i++) if (!(("memory/" hubref[i]) in exists)) err("memory/MEMORY.md: memory/" hubref[i] " doesn\047t exist")

  for (i = 1; i <= nl; i++) {
    l = link[i]
    if (!(("memory/" l ".md") in exists) && !((".claude/rules/memory/" l ".md") in exists)) err(lfile[i] ": [[" l "]] points to no note")
  }

  if (nst) {
    print "memory: this commit changes files these memories cover. Check they still hold:"
    for (i = 1; i <= nst; i++) print "  " stalelist[i]
    print "Claude: hand these files and `git diff --cached` to the project-memory:memory-keeper agent."
  }
  exit fail
}' - "$@" >&2
