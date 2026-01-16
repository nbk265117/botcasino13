/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ██████╗  ██████╗ ████████╗ ██████╗ █████╗ ███████╗██╗███╗   ██╗ ██████╗  ██╗██████╗
 *  ██╔══██╗██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗██╔════╝██║████╗  ██║██╔═══██╗███║╚════██╗
 *  ██████╔╝██║   ██║   ██║   ██║     ███████║███████╗██║██╔██╗ ██║██║   ██║╚██║ █████╔╝
 *  ██╔══██╗██║   ██║   ██║   ██║     ██╔══██║╚════██║██║██║╚██╗██║██║   ██║ ██║ ╚═══██╗
 *  ██████╔╝╚██████╔╝   ██║   ╚██████╗██║  ██║███████║██║██║ ╚████║╚██████╔╝ ██║██████╔╝
 *  ╚═════╝  ╚═════╝    ╚═╝    ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═╝╚═════╝
 *
 *  ICT-Based Polymarket BTC Direction Trading Bot
 *  13-Win Challenge: $12 → $98,304
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import dotenv from 'dotenv';
import cron from 'node-cron';
import { TradeDecisionEngine } from './tradeDecision.js';
import { PolymarketClient } from './polymarket/client.js';
import { KillzoneDetector } from './ict/killzones.js';
import { CONFIG } from '../config/settings.js';

dotenv.config();

class BotCasino13 {
  constructor() {
    this.decisionEngine = new TradeDecisionEngine();
    this.polymarket = new PolymarketClient(process.env.PRIVATE_KEY);
    this.killzones = new KillzoneDetector();

    // Challenge state
    this.state = {
      currentCapital: CONFIG.CHALLENGE.STARTING_CAPITAL,
      consecutiveWins: 0,
      totalTrades: 0,
      tradeHistory: [],
      startTime: new Date().toISOString(),
      challengeActive: true
    };
  }

  /**
   * Print banner
   */
  printBanner() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  BOT CASINO 13 - ICT Polymarket BTC Direction Trader');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('  CHALLENGE:');
    console.log(`    Start:    $${CONFIG.CHALLENGE.STARTING_CAPITAL}`);
    console.log(`    Target:   $${CONFIG.CHALLENGE.TARGET_CAPITAL.toLocaleString()}`);
    console.log(`    Method:   13 consecutive ALL-IN wins (2x each)`);
    console.log('');
    console.log('  CURRENT STATE:');
    console.log(`    Capital:  $${this.state.currentCapital.toFixed(2)}`);
    console.log(`    Wins:     ${this.state.consecutiveWins}/13`);
    console.log(`    Trades:   ${this.state.totalTrades}`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
  }

  /**
   * Run single analysis cycle
   */
  async analyze() {
    console.log(`\n[${new Date().toISOString()}] Running ICT Analysis...`);

    try {
      const analysis = await this.decisionEngine.getAnalysis();
      console.log(analysis.summary);

      return analysis;

    } catch (error) {
      console.error('Analysis error:', error.message);
      return null;
    }
  }

  /**
   * Execute trade on Polymarket
   */
  async executeTrade(decision) {
    if (decision.action === 'NO_TRADE') {
      return { executed: false, reason: 'No trade signal' };
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    EXECUTING TRADE                                ');
    console.log('═══════════════════════════════════════════════════════════════════');

    try {
      // Find today's BTC market
      const marketSearch = await this.polymarket.findTodaysBTCMarket();

      if (!marketSearch.found) {
        console.log(`Market not found: ${marketSearch.reason}`);
        return { executed: false, reason: marketSearch.reason };
      }

      const market = marketSearch.market;
      console.log(`Market: ${market.question}`);
      console.log(`Expiry: ${market.endDateISO} (${market.hoursUntilExpiry.toFixed(1)}h)`);

      // Check odds
      const direction = decision.action === 'LONG' ? 'UP' : 'DOWN';
      const price = direction === 'UP' ? market.outcomes.yes.price : market.outcomes.no.price;
      const oddsCheck = this.polymarket.checkOddsAcceptable(price, direction);

      if (!oddsCheck.acceptable) {
        console.log(`Odds not acceptable: ${oddsCheck.reason}`);
        return { executed: false, reason: oddsCheck.reason };
      }

      console.log(`Direction: ${direction}`);
      console.log(`Price: ${price.toFixed(4)}`);
      console.log(`Potential Return: ${(oddsCheck.potentialReturn * 100).toFixed(0)}%`);

      // Prepare order (ALL-IN)
      const order = this.polymarket.prepareOrder(market, direction, this.state.currentCapital);

      console.log('');
      console.log(`Amount: $${order.amount.toFixed(2)} (100% ALL-IN)`);
      console.log(`Shares: ${order.shares.toFixed(4)}`);
      console.log(`Potential Payout: $${order.potentialPayout.toFixed(2)}`);

      // Execute (simulation mode for now)
      const result = await this.polymarket.executeOrder(order);

      return result;

    } catch (error) {
      console.error('Trade execution error:', error.message);
      return { executed: false, error: error.message };
    }
  }

  /**
   * Record trade result (for simulation/tracking)
   */
  recordResult(isWin) {
    if (isWin) {
      this.state.currentCapital *= 2;
      this.state.consecutiveWins++;

      console.log('\n✓ WIN! Capital doubled.');
      console.log(`  New Capital: $${this.state.currentCapital.toFixed(2)}`);
      console.log(`  Wins: ${this.state.consecutiveWins}/13`);

      if (this.state.consecutiveWins >= 13) {
        console.log('\n🎉 CHALLENGE COMPLETE! 🎉');
        console.log(`Final Capital: $${this.state.currentCapital.toFixed(2)}`);
        this.state.challengeActive = false;
      }
    } else {
      console.log('\n✗ LOSS. Challenge failed.');
      console.log('  Resetting to $12...');

      this.state.currentCapital = CONFIG.CHALLENGE.STARTING_CAPITAL;
      this.state.consecutiveWins = 0;
    }

    this.state.totalTrades++;
    this.state.tradeHistory.push({
      timestamp: new Date().toISOString(),
      isWin,
      capitalAfter: this.state.currentCapital,
      consecutiveWins: this.state.consecutiveWins
    });
  }

  /**
   * Main loop - runs during killzones
   */
  async run() {
    this.printBanner();

    console.log('Starting bot in monitoring mode...');
    console.log('Will analyze during London (07:00-10:00 UTC) and NY (13:00-16:00 UTC) killzones.\n');

    // Check immediately
    await this.checkAndTrade();

    // Schedule checks every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.checkAndTrade();
    });

    // Keep process alive
    console.log('Bot running. Press Ctrl+C to stop.\n');
  }

  /**
   * Check conditions and potentially trade
   */
  async checkAndTrade() {
    if (!this.state.challengeActive) {
      console.log('Challenge complete or paused.');
      return;
    }

    const killzoneStatus = this.killzones.getTradingWindowStatus();

    if (!killzoneStatus.canTrade) {
      const next = killzoneStatus.quality?.nextKillzone;
      if (next) {
        console.log(`[${new Date().toISOString()}] Outside killzone. Next: ${next.name} in ${next.hoursUntil}h`);
      }
      return;
    }

    // In killzone - run analysis
    const analysis = await this.analyze();

    if (analysis && analysis.decision.action !== 'NO_TRADE') {
      const tradeResult = await this.executeTrade(analysis.decision);
      console.log('Trade result:', tradeResult);

      // In simulation mode, we can't know actual result
      // In live mode, you would wait for market resolution
    }
  }

  /**
   * Run single analysis (for testing)
   */
  async runOnce() {
    this.printBanner();
    const analysis = await this.analyze();

    if (analysis && analysis.decision.action !== 'NO_TRADE') {
      await this.executeTrade(analysis.decision);
    }
  }
}

// Entry point
const bot = new BotCasino13();

const mode = process.argv[2] || 'once';

if (mode === 'run') {
  bot.run().catch(console.error);
} else {
  bot.runOnce().catch(console.error);
}

export default BotCasino13;
