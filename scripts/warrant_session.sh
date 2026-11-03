#!/bin/bash
# Bounded warrant broker-branch fetch session (TWSE BSR) + CSV rebuild + site publish.
# usage: warrant_session.sh <YYYYMMDD> <minutes>
#   Fetches still-missing warrants for <YYYYMMDD> (biggest traded amount first) for at most
#   <minutes> of wall time (waiting for another TWSE scrape counts too), restarting the fetcher
#   on a 90 s stall or crash. Then ALWAYS rebuilds warrant_branch_<date>.csv from cache and runs
#   publish_site.py. Last line of output is exactly one of:
#     SESSION DONE|PARTIAL|EXPIRED <YYYY-MM-DD> fetched=<n>/<total> amt_pct=<x>
#   Exit code: 0 DONE, 3 PARTIAL, 4 EXPIRED (BSR already serves another day), 2 bad usage.
#   Routine use:  nohup bash warrant_session.sh 20261103 12 > session_20261103.out 2>&1 &
#                 then AwaitShell / poll for '^SESSION ' in that file (chunks <= 13 min).
#   Full log: warrant_run_<YYYY-MM-DD>.log
cd "$(dirname "$0")"
D=$1; MIN=$2
if ! [[ "$D" =~ ^[0-9]{8}$ && "$MIN" =~ ^[0-9]+$ ]]; then echo "usage: $0 <YYYYMMDD> <minutes>"; exit 2; fi
DD="${D:0:4}-${D:4:2}-${D:6:2}"
LOG=warrant_run_$DD.log
END=$(( $(date +%s) + MIN*60 ))
ts() { TZ=Asia/Taipei date '+%F %T'; }
say() { echo "$(ts) $*" | tee -a "$LOG"; }

# one session at a time (any date)
exec 9>/tmp/warrant_session.lock
if ! flock -n 9; then
  say "another warrant_session is running; waiting (counts against budget)"
  flock -w $(( END - $(date +%s) > 0 ? END - $(date +%s) : 1 )) 9 || say "lock wait timed out"
fi
# never scrape TWSE in parallel: wait for stock scrape / old watchdog / stray fetchers
busy() { pgrep -f 'fetch_all.py|fetch_warrants.py --date|warrant_watchdog.sh|wait_and_run.sh|watchdog.sh --stock' >/dev/null; }
while busy && [ "$(date +%s)" -lt "$END" ]; do sleep 15; done
busy && say "other TWSE scrape still running at budget end; skipping fetch"

RES=partial
while ! busy && [ "$(date +%s)" -lt $(( END - 20 )) ]; do
  left=$(awk "BEGIN{printf \"%.2f\", ($END - $(date +%s))/60}")
  say "fetch start (budget left ${left} min)"
  python3 fetch_warrants.py --date "$D" --max-minutes "$left" >> "$LOG" 2>&1 &
  PID=$!
  while kill -0 $PID 2>/dev/null; do
    sleep 15
    recent=$(find "$DD/warrant_raw" -name '*.csv*' -mmin -1.5 2>/dev/null | wc -l)
    started=$(ps -o etimes= -p $PID 2>/dev/null | tr -d ' ')
    if [ "$recent" -eq 0 ] && [ -n "$started" ] && [ "$started" -gt 90 ]; then
      say "stall >90s, restarting fetcher"; kill $PID; sleep 2; kill -9 $PID 2>/dev/null
    elif [ "$(date +%s)" -gt $(( END + 120 )) ]; then
      say "hard budget overrun, stopping fetcher"; kill $PID; sleep 2; kill -9 $PID 2>/dev/null
    fi
  done
  wait $PID; rc=$?
  say "fetch exit rc=$rc"
  case $rc in
    0) RES=done; break;;
    3) RES=partial; break;;
    4) RES=expired; break;;
    *) sleep 5;;   # crash / killed on stall -> restart while budget remains
  esac
done

# always rebuild CSV from cache (no network if warrant_list.json exists)
ST=$(python3 fetch_warrants.py --date "$D" --csv-only 2>&1 | tee -a "$LOG" | grep '^STATUS' | tail -1)
FETCHED=$(sed -n 's/.*fetched=\([0-9]*\/[0-9]*\).*/\1/p' <<<"$ST")
PCT=$(sed -n 's/.*amt_pct=\([0-9.]*\).*/\1/p' <<<"$ST")
[ -z "$FETCHED" ] && { FETCHED=0/0; PCT=0.0; }
if [ "$RES" != expired ]; then
  n=${FETCHED%/*}; t=${FETCHED#*/}
  if [ "$t" -gt 0 ] && [ "$n" -eq "$t" ]; then RES=done; else RES=partial; fi
fi

if [ -f "warrant_branch_$DD.csv" ]; then
  say "publishing $DD"
  ( cd /workspace/twse-broker-branch && python3 publish_site.py "$DD" --src /workspace/broker_branch ) >> "$LOG" 2>&1 \
    && say "publish ok" || say "PUBLISH FAILED (see $LOG)"
else
  say "no warrant_branch_$DD.csv; nothing to publish"
fi

LINE="SESSION ${RES^^} $DD fetched=$FETCHED amt_pct=$PCT"
echo "$(ts) $LINE" >> "$LOG"
echo "$LINE"
case $RES in done) exit 0;; partial) exit 3;; expired) exit 4;; esac
