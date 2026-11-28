#!/bin/sh
# Tries the one-line install for real, the way a person meets it, against a local archive and a local package:
# the line is piped into sh, Open Sourcebook starts on private ports with no browser, the line is run a second time
# (which updates and starts again), and it is stopped. Nothing is downloaded from the public address.
#
#   sh install/test/try.sh <app archive .tar.gz> <package .tgz> [first port]
#
# It refuses to run where Open Sourcebook is already installed, so it is for a throwaway home:
#   HOME=/some/empty/folder sh install/test/try.sh app.tar.gz opensourcebook-0.1.0.tgz 9300
set -eu

[ $# -ge 2 ] || { echo "usage: sh install/test/try.sh <app archive .tar.gz> <package .tgz> [first port]" >&2; exit 2; }
here=$(cd "$(dirname "$0")/.." && pwd)
ports=${3:-9300}
home=${OPENSOURCEBOOK_HOME:-$HOME/.opensourcebook}
word=$home/bin/opensourcebook

if [ -e "$home" ]; then
  echo "$home is already there. This test is for a throwaway home: set HOME to an empty folder and run it again." >&2
  exit 2
fi

OPENSOURCEBOOK_ARCHIVE=$1
OPENSOURCEBOOK_PACKAGE=$2
export OPENSOURCEBOOK_ARCHIVE OPENSOURCEBOOK_PACKAGE

had_node=no
if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 24')" = true ]; then had_node=yes; fi
had_ffmpeg=no
command -v ffmpeg >/dev/null 2>&1 && had_ffmpeg=yes

step() { printf '\n=== %s\n' "$1"; }
fail() { printf '\nFAILED: %s\n' "$1" >&2; "$word" stop >/dev/null 2>&1 || true; exit 1; }

the_line() { sh -s -- --no-open --ports-from "$ports" < "$here/site/install"; }

four_up() {
  "$word" status > "$home/try-status.txt" 2>&1 || true
  cat "$home/try-status.txt"
  for program in "Agent connector" "Video scenes" "Engine" "Web app"; do
    grep -E "$program +up " "$home/try-status.txt" >/dev/null || return 1
  done
}

step "The line, on a computer that has never had it (Node 24 here: $had_node, ffmpeg here: $had_ffmpeg)"
the_line || fail "the first run of the line did not finish"

step "What it left"
[ -x "$word" ] || fail "there is no $word"
[ -f "$home/app/package.json" ] || fail "the app was not unpacked into $home/app"
[ -f "$home/app.manifest" ] || fail "there is no list of the app's files"
if [ "$had_node" = no ]; then
  [ -x "$home/node/bin/node" ] || fail "no Node 24 was here and no private copy was made"
  echo "A private Node was made: $("$home/node/bin/node" --version)"
else
  [ ! -e "$home/node" ] || fail "Node 24 was already here and a private copy was made anyway"
  echo "The Node already here was used."
fi
if [ "$had_ffmpeg" = no ]; then
  [ -x "$home/bin/ffmpeg" ] || fail "ffmpeg was missing and was not fetched"
  "$home/bin/ffmpeg" -version | head -1
fi

step "Each of the four programs answers"
four_up || fail "not every program answers after the first run"

step "The line a second time: it updates and starts again, and what the person made is kept"
echo kept > "$home/app/try-kept.txt"
the_line || fail "the second run of the line did not finish"
[ "$(cat "$home/app/try-kept.txt" 2>/dev/null)" = kept ] || fail "the second run removed a file the person made"
four_up || fail "not every program answers after the second run"

step "Stopping"
"$word" stop || fail "stop did not work"
sleep 2
if four_up >/dev/null 2>&1; then fail "it still answers after stop"; fi

printf '\nPASSED: the line installed, started, updated and stopped Open Sourcebook in %s\n' "$home"
