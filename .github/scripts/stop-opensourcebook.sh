#!/usr/bin/env bash
# Ctrl-C to the running launcher, then: it is gone, and nothing it started is left. Usage: stop-opensourcebook.sh <its log>
set -u
pid=$(node -p 'JSON.parse(require("fs").readFileSync(require("path").join(process.env.OPENSOURCEBOOK_APP_DATA,"state","running.json"),"utf8")).pid')
kill -INT "$pid"
for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
tail -3 "$1"
if kill -0 "$pid" 2>/dev/null; then echo "the launcher is still running"; exit 1; fi

# A leftover is a process of Open Sourcebook's programs that runs in this checkout. The names alone also match other processes of
# the machine, so a match counts only when its working folder is this checkout or inside it, and this script and the
# shells that ran it never count.
here=$(pwd -P)
mine=" $$ "
p=$$
while [ "$p" -gt 1 ]; do p=$(ps -o ppid= -p "$p" | tr -d ' '); [ -n "$p" ] || break; mine="$mine$p "; done
leftovers() {
  for p in $(pgrep -f "workerd|wrangler|vite|serve-worker|scripts/dev.ts|src/main.ts"); do
    case "$mine" in *" $p "*) continue ;; esac
    cwd=$(readlink "/proc/$p/cwd" 2>/dev/null) || continue
    case "$cwd/" in "$here/"*) echo "$p" ;; esac
  done
}

# A program the launcher stopped can take a moment to be gone from the process table; one still there after a few
# seconds is left running.
for i in $(seq 1 5); do
  left=$(leftovers)
  [ -z "$left" ] && exit 0
  sleep 1
done
echo "something is left running:"
for p in $left; do ps -o pid=,ppid=,pgid=,etime=,args= -p "$p" || echo "$p (gone while printing)"; done
exit 1
