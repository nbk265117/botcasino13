/**
 * News Sentiment Analysis Module
 *
 * Aggregates sentiment from multiple sources:
 * - LunarCrush: Social sentiment & Galaxy Score
 * - CryptoNews-API: News headlines sentiment
 * - Custom macro event analysis
 *
 * Provides directional bias for trading decisions
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚠️  WARNING: LOOK-AHEAD BIAS IN BACKTEST MODE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module uses REAL-TIME APIs that return CURRENT data.
 * Using this in backtest mode would cause SEVERE LOOK-AHEAD BIAS:
 *
 * - Fear & Greed Index: Returns TODAY's value, not historical
 * - LunarCrush: Returns CURRENT sentiment, not historical
 * - CryptoNews: Returns RECENT headlines, not historical
 *
 * PRODUCTION: ✅ Safe to use (real-time data is appropriate)
 * BACKTEST:   ❌ DO NOT USE (would use future data to predict past)
 *
 * To use in backtest, you would need:
 * - Historical Fear & Greed data feed
 * - Historical sentiment snapshots
 * - Point-in-time news archives
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { CONFIG } from '../../config/settings.js';

export class NewsSentiment {
  constructor(options = {}) {
    this.config = CONFIG.DATA_SOURCES?.NEWS_SENTIMENT || {};
    this.lunarCrushApiKey = process.env.LUNARCRUSH_API_KEY || '';
    this.cryptoNewsApiKey = process.env.CRYPTONEWS_API_KEY || '';
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes

    // BACKTEST PROTECTION
    this.isBacktestMode = options.backtestMode || false;
    this.allowInBacktest = options.allowInBacktest || false; // Must explicitly allow
  }

  /**
   * Check if we're being used inappropriately in backtest
   */
  _checkBacktestSafety(methodName) {
    if (this.isBacktestMode && !this.allowInBacktest) {
      const error = new Error(
        `⚠️ LOOK-AHEAD BIAS BLOCKED: NewsSentiment.${methodName}() cannot be used in backtest mode.\n` +
        `This module uses real-time APIs that would cause severe look-ahead bias.\n` +
        `The backtest would use TODAY's sentiment to make decisions about HISTORICAL trades.\n\n` +
        `Options:\n` +
        `1. Remove sentiment analysis from backtest (recommended)\n` +
        `2. Use historical sentiment data feed\n` +
        `3. Set allowInBacktest: true (NOT RECOMMENDED - results will be invalid)`
      );
      error.code = 'LOOKAHEAD_BIAS_BLOCKED';
      throw error;
    }
  }

  /**
   * Get aggregated sentiment from all sources
   */
  async getAggregateSentiment() {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getAggregateSentiment');

    const cacheKey = 'aggregate_sentiment';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const results = await Promise.allSettled([
      this.getLunarCrushSentiment(),
      this.getCryptoNewsSentiment(),
      this.getSocialTrends()
    ]);

    const lunarCrush = results[0].status === 'fulfilled' ? results[0].value : null;
    const cryptoNews = results[1].status === 'fulfilled' ? results[1].value : null;
    const socialTrends = results[2].status === 'fulfilled' ? results[2].value : null;

    // Calculate weighted sentiment score (-100 to +100)
    let totalWeight = 0;
    let weightedScore = 0;

    if (lunarCrush?.valid) {
      const weight = 0.4; // LunarCrush is most reliable
      weightedScore += lunarCrush.sentimentScore * weight;
      totalWeight += weight;
    }

    if (cryptoNews?.valid) {
      const weight = 0.35;
      weightedScore += cryptoNews.sentimentScore * weight;
      totalWeight += weight;
    }

    if (socialTrends?.valid) {
      const weight = 0.25;
      weightedScore += socialTrends.sentimentScore * weight;
      totalWeight += weight;
    }

    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // Determine directional bias
    let bias = 'NEUTRAL';
    let confidence = Math.abs(finalScore) / 100;

    if (finalScore >= 30) {
      bias = 'BULLISH';
    } else if (finalScore <= -30) {
      bias = 'BEARISH';
    }

    const result = {
      valid: totalWeight > 0,
      bias,
      confidence,
      score: finalScore,
      sources: {
        lunarCrush,
        cryptoNews,
        socialTrends
      },
      timestamp: new Date().toISOString()
    };

    this.setCache(cacheKey, result);
    return result;
  }

  /**
   * LunarCrush API - Social sentiment & Galaxy Score
   * https://lunarcrush.com/developers/api
   */
  async getLunarCrushSentiment() {
    if (!this.lunarCrushApiKey) {
      return this.getMockLunarCrushData();
    }

    try {
      // LunarCrush v3 API endpoint
      const response = await fetch(
        `https://lunarcrush.com/api3/coins/btc/time-series/v2?key=${this.lunarCrushApiKey}&bucket=day&interval=7d`,
        {
          headers: {
            'Authorization': `Bearer ${this.lunarCrushApiKey}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`LunarCrush API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        return { valid: false, reason: 'No data from LunarCrush' };
      }

      const latest = data.data[data.data.length - 1];
      const previous = data.data[data.data.length - 2] || latest;

      // Galaxy Score: 0-100 (higher = more bullish social sentiment)
      const galaxyScore = latest.galaxy_score || 50;
      const altRank = latest.alt_rank || 50;
      const socialVolume = latest.social_volume || 0;
      const socialVolumeChange = previous.social_volume
        ? ((socialVolume - previous.social_volume) / previous.social_volume) * 100
        : 0;

      // Sentiment: 1-5 scale, convert to -100 to +100
      const rawSentiment = latest.sentiment || 3;
      const sentimentScore = ((rawSentiment - 3) / 2) * 100;

      // Adjust by Galaxy Score trend
      const galaxyBoost = (galaxyScore - 50) * 0.5;

      return {
        valid: true,
        sentimentScore: Math.max(-100, Math.min(100, sentimentScore + galaxyBoost)),
        galaxyScore,
        altRank,
        socialVolume,
        socialVolumeChange,
        rawSentiment,
        source: 'lunarcrush'
      };

    } catch (error) {
      console.error('LunarCrush API error:', error.message);
      return this.getMockLunarCrushData();
    }
  }

  /**
   * CryptoNews-API - News headlines sentiment
   * https://cryptonews-api.com/
   */
  async getCryptoNewsSentiment() {
    if (!this.cryptoNewsApiKey) {
      return this.getMockCryptoNewsData();
    }

    try {
      const response = await fetch(
        `https://cryptonews-api.com/api/v1/category?section=alltickers&items=50&token=${this.cryptoNewsApiKey}&tickers=BTC`
      );

      if (!response.ok) {
        throw new Error(`CryptoNews API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        return { valid: false, reason: 'No news data' };
      }

      // Analyze headlines for sentiment
      const sentimentResults = data.data.map(article =>
        this.analyzeHeadlineSentiment(article.title)
      );

      const avgSentiment = sentimentResults.reduce((a, b) => a + b, 0) / sentimentResults.length;
      const positiveCount = sentimentResults.filter(s => s > 20).length;
      const negativeCount = sentimentResults.filter(s => s < -20).length;

      return {
        valid: true,
        sentimentScore: avgSentiment,
        articlesAnalyzed: data.data.length,
        positiveCount,
        negativeCount,
        neutralCount: data.data.length - positiveCount - negativeCount,
        recentHeadlines: data.data.slice(0, 5).map(a => ({
          title: a.title,
          sentiment: this.analyzeHeadlineSentiment(a.title),
          date: a.date
        })),
        source: 'cryptonews'
      };

    } catch (error) {
      console.error('CryptoNews API error:', error.message);
      return this.getMockCryptoNewsData();
    }
  }

  /**
   * Free social trends from public APIs
   */
  async getSocialTrends() {
    try {
      // Fear & Greed Index (free API)
      const fgResponse = await fetch('https://api.alternative.me/fng/?limit=7');
      const fgData = await fgResponse.json();

      if (!fgData.data || fgData.data.length === 0) {
        return { valid: false, reason: 'No Fear & Greed data' };
      }

      const latest = fgData.data[0];
      const fgValue = parseInt(latest.value); // 0-100
      const fgClassification = latest.value_classification;

      // Convert Fear & Greed to sentiment (-100 to +100)
      // 0-25: Extreme Fear = -100 to -50 (contrarian bullish)
      // 25-45: Fear = -50 to 0
      // 45-55: Neutral = 0
      // 55-75: Greed = 0 to +50
      // 75-100: Extreme Greed = +50 to +100 (contrarian bearish)

      let sentimentScore;
      let contrarian = false;

      // Use contrarian logic for extremes
      if (fgValue <= 20) {
        // Extreme fear = contrarian bullish
        sentimentScore = 50 + (20 - fgValue) * 2.5; // 50 to 100
        contrarian = true;
      } else if (fgValue >= 80) {
        // Extreme greed = contrarian bearish
        sentimentScore = -50 - (fgValue - 80) * 2.5; // -50 to -100
        contrarian = true;
      } else {
        // Normal: follow the sentiment
        sentimentScore = (fgValue - 50) * 2;
      }

      // Calculate trend (comparing to 7 days ago)
      const oldest = fgData.data[fgData.data.length - 1];
      const trend = fgValue - parseInt(oldest.value);

      return {
        valid: true,
        sentimentScore,
        fearGreedIndex: fgValue,
        classification: fgClassification,
        contrarian,
        trend,
        trendDirection: trend > 5 ? 'IMPROVING' : trend < -5 ? 'WORSENING' : 'STABLE',
        source: 'alternative.me'
      };

    } catch (error) {
      console.error('Social trends API error:', error.message);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Analyze headline sentiment using keyword matching
   * Returns score from -100 to +100
   */
  analyzeHeadlineSentiment(headline) {
    const text = headline.toLowerCase();

    const bullishKeywords = {
      strong: ['surge', 'soar', 'rally', 'breakout', 'bull', 'moon', 'ath', 'all-time high',
               'record', 'explode', 'skyrocket', 'milestone', 'institutional buying', 'etf inflow',
               'adoption', 'approval', 'partnership', 'bullish'],
      moderate: ['rise', 'gain', 'up', 'grow', 'increase', 'recover', 'rebound', 'positive',
                 'optimistic', 'buy', 'accumulate', 'support', 'higher', 'upgrade']
    };

    const bearishKeywords = {
      strong: ['crash', 'plunge', 'collapse', 'dump', 'bear', 'capitulation', 'liquidation',
               'hack', 'scam', 'fraud', 'ban', 'crackdown', 'lawsuit', 'sec', 'regulation',
               'etf outflow', 'sell-off', 'bearish'],
      moderate: ['fall', 'drop', 'decline', 'down', 'decrease', 'sell', 'correction', 'pullback',
                 'concern', 'risk', 'warning', 'uncertainty', 'lower', 'downgrade', 'fear']
    };

    let score = 0;

    // Check bullish keywords
    for (const word of bullishKeywords.strong) {
      if (text.includes(word)) score += 30;
    }
    for (const word of bullishKeywords.moderate) {
      if (text.includes(word)) score += 15;
    }

    // Check bearish keywords
    for (const word of bearishKeywords.strong) {
      if (text.includes(word)) score -= 30;
    }
    for (const word of bearishKeywords.moderate) {
      if (text.includes(word)) score -= 15;
    }

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Mock data when APIs not available
   */
  getMockLunarCrushData() {
    return {
      valid: true,
      sentimentScore: 0,
      galaxyScore: 50,
      altRank: 1,
      socialVolume: 50000,
      socialVolumeChange: 0,
      rawSentiment: 3,
      source: 'mock',
      note: 'Using mock data - set LUNARCRUSH_API_KEY for real data'
    };
  }

  getMockCryptoNewsData() {
    return {
      valid: true,
      sentimentScore: 0,
      articlesAnalyzed: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      recentHeadlines: [],
      source: 'mock',
      note: 'Using mock data - set CRYPTONEWS_API_KEY for real data'
    };
  }

  /**
   * Cache helpers
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Get sentiment signal for trade decision
   */
  async getSentimentSignal(expectedDirection) {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getSentimentSignal');

    const sentiment = await this.getAggregateSentiment();

    if (!sentiment.valid) {
      return {
        aligned: false,
        reason: 'No sentiment data available',
        score: 0
      };
    }

    const aligned = (
      (expectedDirection === 'BULLISH' && sentiment.bias === 'BULLISH') ||
      (expectedDirection === 'BEARISH' && sentiment.bias === 'BEARISH') ||
      sentiment.bias === 'NEUTRAL'
    );

    return {
      aligned,
      bias: sentiment.bias,
      score: sentiment.score,
      confidence: sentiment.confidence,
      reason: aligned
        ? `Sentiment ${sentiment.bias} aligns with ${expectedDirection} trade`
        : `Sentiment ${sentiment.bias} conflicts with ${expectedDirection} trade`,
      details: sentiment.sources
    };
  }
}

export default NewsSentiment;
