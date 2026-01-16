/**
 * Telegram Notification Service
 * Sends alerts for trades, heartbeats, and system events
 */

import axios from 'axios';

export class TelegramNotifier {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.enabled = !!(this.botToken && this.chatId);
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Send a message to Telegram
   */
  async send(message, options = {}) {
    if (!this.enabled) {
      console.log('[Telegram] Notifications disabled (missing token/chatId)');
      return { success: false, reason: 'disabled' };
    }

    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: options.parseMode || 'HTML',
        disable_web_page_preview: true
      });

      return { success: true, messageId: response.data.result.message_id };
    } catch (error) {
      console.error('[Telegram] Send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send trade alert
   */
  async sendTradeAlert(trade) {
    const emoji = trade.action === 'LONG' ? '🟢' : '🔴';
    const direction = trade.action === 'LONG' ? 'UP' : 'DOWN';

    const message = `
${emoji} <b>TRADE EXECUTED</b> ${emoji}

<b>Direction:</b> ${direction} (${trade.action})
<b>Model:</b> ${trade.model || 'N/A'}
<b>Confluence:</b> ${trade.confluence}/10
<b>Confidence:</b> ${(trade.confidence * 100).toFixed(0)}%

<b>Amount:</b> $${trade.amount?.toFixed(2) || '12.00'} (ALL-IN)
<b>Potential Payout:</b> $${trade.potentialPayout?.toFixed(2) || 'N/A'}

<b>Challenge Status:</b>
  Wins: ${trade.wins}/13
  Capital: $${trade.capital?.toFixed(2) || '12.00'}

<b>Market:</b> ${trade.market || 'BTC Daily Direction'}

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Send trade result alert
   */
  async sendResultAlert(result) {
    const emoji = result.isWin ? '✅' : '❌';
    const status = result.isWin ? 'WIN' : 'LOSS';

    const message = `
${emoji} <b>TRADE RESULT: ${status}</b> ${emoji}

<b>Direction:</b> ${result.direction}
<b>Result:</b> ${status}

<b>New Capital:</b> $${result.newCapital?.toFixed(2)}
<b>Consecutive Wins:</b> ${result.consecutiveWins}/13

${result.isWin && result.consecutiveWins >= 13 ? '🎉🎉🎉 CHALLENGE COMPLETE! 🎉🎉🎉' : ''}
${!result.isWin ? '🔄 Resetting to $12...' : ''}

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Send heartbeat status
   */
  async sendHeartbeat(status) {
    const uptime = this.formatUptime(status.uptimeSeconds);
    const memUsage = status.memoryMB?.toFixed(1) || 'N/A';

    const message = `
💓 <b>HEARTBEAT STATUS</b>

<b>Bot:</b> ${status.running ? '🟢 Running' : '🔴 Stopped'}
<b>Uptime:</b> ${uptime}
<b>Memory:</b> ${memUsage} MB

<b>Challenge Status:</b>
  Capital: $${status.capital?.toFixed(2) || '12.00'}
  Wins: ${status.wins || 0}/13
  Trades Today: ${status.tradesToday || 0}

<b>Next Killzone:</b> ${status.nextKillzone || 'N/A'}

<b>Last Analysis:</b> ${status.lastAnalysis || 'None'}

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Send startup alert
   */
  async sendStartupAlert(info = {}) {
    const message = `
🚀 <b>BOT STARTED</b>

<b>Version:</b> ${info.version || '1.0.0'}
<b>Mode:</b> ${info.mode || 'Production'}
<b>Node:</b> ${process.version}

<b>Initial Capital:</b> $${info.capital?.toFixed(2) || '12.00'}
<b>Target:</b> $98,304

<b>Monitoring:</b>
  London: 07:00-10:00 UTC
  NY AM: 13:00-16:00 UTC

🎯 Challenge: 13 consecutive wins

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Send shutdown/restart alert
   */
  async sendShutdownAlert(reason = 'Unknown') {
    const message = `
⚠️ <b>BOT SHUTDOWN</b>

<b>Reason:</b> ${reason}
<b>Time:</b> ${new Date().toISOString()}

Bot will auto-restart via PM2.
    `.trim();

    return this.send(message);
  }

  /**
   * Send error alert
   */
  async sendErrorAlert(error) {
    const message = `
🚨 <b>ERROR ALERT</b>

<b>Error:</b> ${error.message || error}
<b>Type:</b> ${error.name || 'Unknown'}

<b>Stack:</b>
<code>${(error.stack || '').slice(0, 500)}</code>

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Send analysis alert (no trade)
   */
  async sendAnalysisAlert(analysis) {
    if (analysis.action !== 'NO_TRADE') return; // Only send for no-trade

    const message = `
📊 <b>ANALYSIS COMPLETE</b>

<b>Result:</b> NO TRADE
<b>Reason:</b> ${analysis.reasons?.[0] || 'Conditions not met'}

${analysis.reasons?.slice(1, 4).map(r => `• ${r}`).join('\n') || ''}

⏰ ${new Date().toISOString()}
    `.trim();

    return this.send(message);
  }

  /**
   * Format uptime
   */
  formatUptime(seconds) {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
}

export default TelegramNotifier;
