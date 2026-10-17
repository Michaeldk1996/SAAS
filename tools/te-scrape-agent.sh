#!/bin/sh
# TEN-443 · launchd entry for the Tennis Explorer scrape (com.stennisfy.te-scrape, every 30 min + at load).
# Resumes from cache after sleep, reboot or a lost connection. Exits at once if a run holds the lock, if DONE is
# present for this roster, or if BLOCKED is present (a non-200/challenge page — needs a person, never auto-retried).
C="${TE_CACHE:-$HOME/.stennisfy/te-cache}"
[ -f "$C/BLOCKED" ] && exit 0
[ -f "$C/DONE" ] && [ "$C/DONE" -nt "$C/roster.json" ] && exit 0
exec /usr/bin/env node "$HOME/.stennisfy/te-scrape.run.mjs" --players "$C/roster.json" >> "$C/run.out" 2>&1
