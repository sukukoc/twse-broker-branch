#!/bin/bash
# Run fetch_all.py; restart it if no new raw file appears for 90s.
cd "$(dirname "$0")"
LOG=${LOG:-watchdog.log}
while true; do
  python3 fetch_all.py "$@" >> "$LOG" 2>&1 &
  PID=$!
  last=$(find . -path '*/raw/*.csv' -newermt '-90 seconds' | wc -l)
  while kill -0 $PID 2>/dev/null; do
    sleep 30
    recent=$(find . -path '*/raw/*.csv' -mmin -1.5 | wc -l)
    if [ "$recent" -eq 0 ] && [ $(( $(date +%s) - $(stat -c %Y "$LOG") )) -gt 90 -o "$recent" -eq 0 ]; then
      started=$(ps -o etimes= -p $PID 2>/dev/null | tr -d ' ')
      if [ -n "$started" ] && [ "$started" -gt 90 ]; then echo "WATCHDOG: stall, restarting" >> "$LOG"; kill $PID; sleep 2; kill -9 $PID 2>/dev/null; fi
    fi
  done
  wait $PID; rc=$?
  [ $rc -eq 0 ] && { echo "WATCHDOG: done" >> "$LOG"; break; }
  sleep 5
done
