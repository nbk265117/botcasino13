/**
 * Test script for external data modules
 * Run: node src/testExternalData.js
 */

import { NewsSentiment } from './data/newsSentiment.js';
import { ETFFlows } from './data/etfFlows.js';
import { EconomicCalendar } from './data/economicCalendar.js';

async function testModules() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           TESTING EXTERNAL DATA MODULES');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ─────────────────────────────────────────────────────────────────────
  // Test 1: News Sentiment
  // ─────────────────────────────────────────────────────────────────────
  console.log('📰 Testing News Sentiment Module...\n');
  const sentiment = new NewsSentiment();

  try {
    const aggregateSentiment = await sentiment.getAggregateSentiment();
    console.log('Aggregate Sentiment:');
    console.log(`  Bias: ${aggregateSentiment.bias}`);
    console.log(`  Score: ${aggregateSentiment.score.toFixed(1)}`);
    console.log(`  Confidence: ${(aggregateSentiment.confidence * 100).toFixed(0)}%`);
    console.log(`  Valid: ${aggregateSentiment.valid}`);

    if (aggregateSentiment.sources.socialTrends?.valid) {
      console.log(`\n  Fear & Greed Index: ${aggregateSentiment.sources.socialTrends.fearGreedIndex}`);
      console.log(`  Classification: ${aggregateSentiment.sources.socialTrends.classification}`);
      console.log(`  Contrarian: ${aggregateSentiment.sources.socialTrends.contrarian}`);
    }

    // Test signal alignment
    const bullishSignal = await sentiment.getSentimentSignal('BULLISH');
    console.log(`\n  Aligned with BULLISH trade: ${bullishSignal.aligned}`);
    console.log(`  Reason: ${bullishSignal.reason}`);

    console.log('\n✅ News Sentiment Module: OK\n');
  } catch (error) {
    console.log(`❌ News Sentiment Error: ${error.message}\n`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: ETF Flows
  // ─────────────────────────────────────────────────────────────────────
  console.log('💰 Testing ETF Flows Module...\n');
  const etf = new ETFFlows();

  try {
    const flows = await etf.getETFFlows();
    console.log('ETF Flows Summary:');
    console.log(`  Daily Flow: $${(flows.summary.totalFlowToday / 1_000_000).toFixed(1)}M`);
    console.log(`  Weekly Flow: $${(flows.summary.totalFlowWeek / 1_000_000).toFixed(1)}M`);
    console.log(`  Total Holdings: $${(flows.summary.totalHoldings / 1_000_000_000).toFixed(1)}B`);
    console.log(`  Direction: ${flows.summary.flowDirection}`);

    console.log('\n  Signal:');
    console.log(`    Bias: ${flows.signal.bias}`);
    console.log(`    Score: ${flows.signal.score}`);
    console.log(`    Strength: ${flows.signal.strength}`);
    console.log(`    Reasoning: ${flows.signal.reasoning}`);

    // Test significant event
    const significantEvent = await etf.checkSignificantFlowEvent();
    if (significantEvent) {
      console.log(`\n  ⚠️ Significant Event: ${significantEvent.message}`);
    }

    // Test signal alignment
    const etfSignal = await etf.getETFSignal('BULLISH');
    console.log(`\n  Aligned with BULLISH trade: ${etfSignal.aligned}`);

    console.log('\n✅ ETF Flows Module: OK\n');
  } catch (error) {
    console.log(`❌ ETF Flows Error: ${error.message}\n`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: Economic Calendar
  // ─────────────────────────────────────────────────────────────────────
  console.log('📅 Testing Economic Calendar Module...\n');
  const calendar = new EconomicCalendar();

  try {
    const events = await calendar.getUpcomingEvents(7);
    console.log('Economic Calendar:');
    console.log(`  Total Events: ${events.events?.length || 0}`);
    console.log(`  High Impact Events: ${events.highImpactEvents?.length || 0}`);

    if (events.highImpactEvents?.length > 0) {
      console.log('\n  Upcoming High-Impact Events:');
      events.highImpactEvents.slice(0, 5).forEach(e => {
        const date = new Date(e.timestamp).toLocaleDateString();
        console.log(`    - ${e.event} (${date})`);
        if (e.interpretation) {
          console.log(`      Interpretation: ${e.interpretation.bias} - ${e.interpretation.reason}`);
        }
      });
    }

    // Test blackout check
    const blackout = await calendar.checkEventBlackout();
    console.log(`\n  Currently in Blackout: ${blackout.inBlackout}`);
    if (blackout.nextHighImpactEvent) {
      console.log(`  Next High-Impact: ${blackout.nextHighImpactEvent.event} in ${blackout.nextHighImpactEvent.hoursUntil}h`);
    }

    // Test economic bias
    const bias = await calendar.getEconomicBias();
    console.log(`\n  Economic Bias: ${bias.bias}`);
    console.log(`  Confidence: ${(bias.confidence * 100).toFixed(0)}%`);
    console.log(`  Reason: ${bias.reason}`);

    // Test signal alignment
    const econSignal = await calendar.getEconomicSignal('BULLISH');
    console.log(`\n  Can Trade: ${econSignal.canTrade}`);
    console.log(`  Aligned with BULLISH: ${econSignal.aligned}`);

    console.log('\n✅ Economic Calendar Module: OK\n');
  } catch (error) {
    console.log(`❌ Economic Calendar Error: ${error.message}\n`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`
Environment Variables Needed for Full Functionality:
  - LUNARCRUSH_API_KEY  : For social sentiment (optional, has free tier)
  - CRYPTONEWS_API_KEY  : For news headlines (optional)
  - COINGLASS_API_KEY   : For ETF flows (optional, has free tier)
  - FINNHUB_API_KEY     : For economic calendar (optional, has free tier)

Without API keys, modules will use:
  - Mock data (neutral signals)
  - Fear & Greed Index (free, no key needed)
  - Basic CoinGlass data (free, limited)

To set API keys:
  export LUNARCRUSH_API_KEY=your_key
  export COINGLASS_API_KEY=your_key
  export FINNHUB_API_KEY=your_key
`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

testModules().catch(console.error);
