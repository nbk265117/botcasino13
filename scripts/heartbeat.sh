#!/bin/bash
#═══════════════════════════════════════════════════════════════════
# HEARTBEAT - Send status to Telegram every hour
#═══════════════════════════════════════════════════════════════════

# Load environment variables
cd "$(dirname "$0")/.."
source .env

# Check if bot is running
BOT_STATUS=$(pm2 jlist 2>/dev/null | node -e "
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    try {
      const procs = JSON.parse(data);
      const bot = procs.find(p => p.name === 'botcasino13');
      if (bot) {
        console.log(JSON.stringify({
          status: bot.pm2_env.status,
          uptime: bot.pm2_env.pm_uptime,
          memory: bot.monit.memory,
          restarts: bot.pm2_env.restart_time
        }));
      } else {
        console.log(JSON.stringify({status: 'not_found'}));
      }
    } catch(e) {
      console.log(JSON.stringify({status: 'error', error: e.message}));
    }
  });
")

# Parse bot info
STATUS=$(echo "$BOT_STATUS" | node -e "
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    const info = JSON.parse(data);
    const running = info.status === 'online' ? '🟢 Running' : '🔴 Stopped';
    const uptime = info.uptime ? Math.floor((Date.now() - info.uptime) / 1000) : 0;
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mem = info.memory ? (info.memory / 1024 / 1024).toFixed(1) : 'N/A';
    console.log(running + '|' + hours + 'h ' + mins + 'm|' + mem + ' MB|' + (info.restarts || 0));
  });
")

IFS='|' read -r RUNNING UPTIME MEMORY RESTARTS <<< "$STATUS"

# Get system info
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}')
LOAD=$(uptime | awk -F'load average:' '{print $2}' | xargs)

# Send to Telegram
MESSAGE="💓 <b>HEARTBEAT STATUS</b>

<b>Bot:</b> $RUNNING
<b>Uptime:</b> $UPTIME
<b>Memory:</b> $MEMORY
<b>Restarts:</b> $RESTARTS

<b>System:</b>
  Disk: $DISK_USAGE used
  Load: $LOAD

⏰ $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=HTML" > /dev/null

echo "[$(date)] Heartbeat sent"
