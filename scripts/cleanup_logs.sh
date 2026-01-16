#!/bin/bash
#═══════════════════════════════════════════════════════════════════
# LOG CLEANUP - Clean old logs and cache files
#═══════════════════════════════════════════════════════════════════

# Load environment variables
cd "$(dirname "$0")/.."
source .env

LOG_DIR="./logs"
MAX_AGE_DAYS=7
MAX_SIZE_MB=100

echo "[$(date)] Starting log cleanup..."

# Count files before
FILES_BEFORE=$(find "$LOG_DIR" -type f 2>/dev/null | wc -l)
SIZE_BEFORE=$(du -sm "$LOG_DIR" 2>/dev/null | cut -f1)

# Delete logs older than MAX_AGE_DAYS
find "$LOG_DIR" -type f -name "*.log" -mtime +$MAX_AGE_DAYS -delete 2>/dev/null

# Rotate large log files
for logfile in "$LOG_DIR"/*.log; do
  if [ -f "$logfile" ]; then
    SIZE=$(du -m "$logfile" 2>/dev/null | cut -f1)
    if [ "$SIZE" -gt "$MAX_SIZE_MB" ]; then
      # Keep last 10000 lines, archive rest
      tail -n 10000 "$logfile" > "$logfile.tmp"
      mv "$logfile.tmp" "$logfile"
      echo "  Rotated: $logfile (was ${SIZE}MB)"
    fi
  fi
done

# Clean PM2 logs
pm2 flush 2>/dev/null

# Clean npm cache (optional, weekly)
if [ "$(date +%u)" -eq 1 ]; then
  npm cache clean --force 2>/dev/null
  echo "  Cleaned npm cache (Monday)"
fi

# Count files after
FILES_AFTER=$(find "$LOG_DIR" -type f 2>/dev/null | wc -l)
SIZE_AFTER=$(du -sm "$LOG_DIR" 2>/dev/null | cut -f1)

# Calculate savings
FILES_REMOVED=$((FILES_BEFORE - FILES_AFTER))
SIZE_SAVED=$((SIZE_BEFORE - SIZE_AFTER))

echo "[$(date)] Cleanup complete:"
echo "  Files removed: $FILES_REMOVED"
echo "  Space saved: ${SIZE_SAVED}MB"
echo "  Current size: ${SIZE_AFTER}MB"

# Send summary to Telegram if significant cleanup
if [ "$SIZE_SAVED" -gt 10 ]; then
  MESSAGE="🧹 <b>LOG CLEANUP</b>

<b>Files removed:</b> $FILES_REMOVED
<b>Space saved:</b> ${SIZE_SAVED}MB
<b>Current size:</b> ${SIZE_AFTER}MB

⏰ $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${MESSAGE}" \
    -d "parse_mode=HTML" > /dev/null
fi
