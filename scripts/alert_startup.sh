#!/bin/bash
#═══════════════════════════════════════════════════════════════════
# STARTUP ALERT - Notify on VPS boot/restart
#═══════════════════════════════════════════════════════════════════

# Load environment variables
cd "$(dirname "$0")/.."
source .env

# Get system info
HOSTNAME=$(hostname)
IP=$(curl -s ifconfig.me 2>/dev/null || echo "Unknown")
UPTIME=$(uptime -p 2>/dev/null || uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1}')
KERNEL=$(uname -r)
NODE_VERSION=$(node -v 2>/dev/null || echo "Not installed")

# Check PM2 status
PM2_STATUS=$(pm2 list 2>/dev/null | grep botcasino13 | awk '{print $10}' || echo "Unknown")

# Send to Telegram
MESSAGE="🚀 <b>VPS STARTED/RESTARTED</b>

<b>Host:</b> $HOSTNAME
<b>IP:</b> $IP
<b>Uptime:</b> $UPTIME

<b>System:</b>
  Kernel: $KERNEL
  Node: $NODE_VERSION

<b>Bot Status:</b> $PM2_STATUS

<b>Action:</b> Bot should auto-start via PM2

⏰ $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=HTML" > /dev/null

echo "[$(date)] Startup alert sent"
