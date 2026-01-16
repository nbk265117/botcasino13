#!/bin/bash
#═══════════════════════════════════════════════════════════════════
# SETUP MONITORING - Configure all monitoring scripts and cron jobs
#═══════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════════════════════════"
echo "              SETTING UP MONITORING                                "
echo "═══════════════════════════════════════════════════════════════════"

# Make scripts executable
chmod +x "$SCRIPT_DIR"/*.sh

# Create cron jobs
echo "Setting up cron jobs..."

# Remove existing botcasino cron jobs
crontab -l 2>/dev/null | grep -v "botcasino13" > /tmp/crontab.tmp || true

# Add new cron jobs
cat >> /tmp/crontab.tmp << EOF
# BotCasino13 Monitoring
# Heartbeat - every hour
0 * * * * cd $BOT_DIR && ./scripts/heartbeat.sh >> ./logs/heartbeat.log 2>&1

# Log cleanup - daily at 04:00 UTC
0 4 * * * cd $BOT_DIR && ./scripts/cleanup_logs.sh >> ./logs/cleanup.log 2>&1
EOF

# Install new crontab
crontab /tmp/crontab.tmp
rm /tmp/crontab.tmp

echo "Cron jobs installed:"
crontab -l | grep botcasino13

# Setup startup alert via systemd
echo ""
echo "Setting up startup alert..."

sudo tee /etc/systemd/system/botcasino-startup.service > /dev/null << EOF
[Unit]
Description=BotCasino13 Startup Alert
After=network-online.target pm2-ubuntu.service
Wants=network-online.target

[Service]
Type=oneshot
User=$(whoami)
WorkingDirectory=$BOT_DIR
ExecStart=$SCRIPT_DIR/alert_startup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable botcasino-startup.service

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "              MONITORING SETUP COMPLETE                            "
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Configured:"
echo "  - Heartbeat: Every hour at :00"
echo "  - Log cleanup: Daily at 04:00 UTC"
echo "  - Startup alert: On VPS boot"
echo ""
echo "Test scripts:"
echo "  ./scripts/heartbeat.sh"
echo "  ./scripts/alert_startup.sh"
echo "  ./scripts/cleanup_logs.sh"
echo ""
