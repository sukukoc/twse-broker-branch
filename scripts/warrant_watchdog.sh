#!/bin/bash
# wait for stock scrape to finish, then run fetch_warrants.py, restart on 90s stall.
cd "$(dirname "$0")"
# usage: warrant_watchdog.sh [YYYYMMDD]   (default: today, Asia/Taipei)
D=${1:-$(TZ=Asia/Taipei date +%Y%m%d)}
DD="${D:0:4}-${D:4:2}-${D:6:2}"
LOG=warrant_run_$DD.log
while pgrep -f 'fetch_all.py|watchdog.sh --stock|wait_and_run.sh' >/dev/null || pgrep -fx 'bash watchdog.sh' >/dev/null; do sleep 20; done
echo "$(date) stock run finished; starting warrants" >> $LOG
while true; do
  python3 fetch_warrants.py --date $D >> $LOG 2>&1 &
  PID=$!
  while kill -0 $PID 2>/dev/null; do
    sleep 30
    recent=$(find $DD/warrant_raw -name '*.csv*' -mmin -1.5 | wc -l)
    started=$(ps -o etimes= -p $PID 2>/dev/null | tr -d ' ')
    if [ "$recent" -eq 0 ] && [ -n "$started" ] && [ "$started" -gt 90 ]; then
      echo "WATCHDOG: stall, restarting" >> $LOG; kill $PID; sleep 2; kill -9 $PID 2>/dev/null
    fi
  done
  wait $PID; rc=$?
  [ $rc -eq 0 ] && { echo "WATCHDOG: done $(date)" >> $LOG; break; }
  sleep 5
done
