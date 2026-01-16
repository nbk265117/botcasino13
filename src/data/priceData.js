/**
 * Price Data Fetcher
 *
 * Fetches OHLCV data from exchanges for ICT analysis
 * Uses ccxt for exchange connectivity
 */

import ccxt from 'ccxt';
import { CONFIG } from '../../config/settings.js';

export class PriceDataFetcher {
  constructor() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
    });
    this.cache = new Map();
    this.cacheExpiry = 60000; // 1 minute cache
  }

  /**
   * Fetch OHLCV candles for a symbol
   */
  async fetchCandles(symbol, timeframe, limit = CONFIG.DATA.CANDLE_LIMIT) {
    const cacheKey = `${symbol}-${timeframe}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);

      const candles = ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp,
        date: new Date(timestamp).toISOString(),
        open,
        high,
        low,
        close,
        volume
      }));

      this.cache.set(cacheKey, {
        data: candles,
        timestamp: Date.now()
      });

      return candles;

    } catch (error) {
      console.error(`Error fetching ${symbol} ${timeframe}:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch BTC candles
   */
  async fetchBTC(timeframe = '5m', limit) {
    return this.fetchCandles(CONFIG.DATA.SYMBOLS.BTC, timeframe, limit);
  }

  /**
   * Fetch ETH candles (for SMT divergence)
   */
  async fetchETH(timeframe = '5m', limit) {
    return this.fetchCandles(CONFIG.DATA.SYMBOLS.ETH, timeframe, limit);
  }

  /**
   * Fetch multiple timeframes for HTF bias analysis
   */
  async fetchMultiTimeframe(symbol = CONFIG.DATA.SYMBOLS.BTC) {
    const timeframes = CONFIG.DATA.TIMEFRAMES;
    const data = {};

    await Promise.all(
      timeframes.map(async (tf) => {
        data[tf] = await this.fetchCandles(symbol, tf);
      })
    );

    return data;
  }

  /**
   * Fetch both BTC and ETH for SMT analysis
   */
  async fetchForSMT(timeframe = '5m', limit) {
    const [btc, eth] = await Promise.all([
      this.fetchBTC(timeframe, limit),
      this.fetchETH(timeframe, limit)
    ]);

    // Align timestamps
    const btcMap = new Map(btc.map(c => [c.timestamp, c]));
    const ethMap = new Map(eth.map(c => [c.timestamp, c]));

    const commonTimestamps = [...btcMap.keys()].filter(ts => ethMap.has(ts));

    return {
      btc: commonTimestamps.map(ts => btcMap.get(ts)),
      eth: commonTimestamps.map(ts => ethMap.get(ts))
    };
  }

  /**
   * Get current price
   */
  async getCurrentPrice(symbol = CONFIG.DATA.SYMBOLS.BTC) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return {
        price: ticker.last,
        bid: ticker.bid,
        ask: ticker.ask,
        spread: (ticker.ask - ticker.bid) / ticker.bid * 100,
        volume24h: ticker.quoteVolume,
        change24h: ticker.percentage
      };
    } catch (error) {
      console.error(`Error fetching ticker for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Calculate ATR (Average True Range) for volatility filter
   */
  calculateATR(candles, period = CONFIG.FILTERS.VOLATILITY.ATR_PERIOD) {
    if (candles.length < period + 1) {
      return null;
    }

    const trueRanges = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );

      trueRanges.push(tr);
    }

    // Calculate ATR (SMA of true ranges)
    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period;

    const currentPrice = candles[candles.length - 1].close;
    const atrPercent = (atr / currentPrice) * 100;

    return {
      atr,
      atrPercent,
      isVolatilityOK: atrPercent >= CONFIG.FILTERS.VOLATILITY.MIN_ATR_PERCENT &&
                      atrPercent <= CONFIG.FILTERS.VOLATILITY.MAX_ATR_PERCENT
    };
  }

  /**
   * Get comprehensive market data for analysis
   */
  async getAnalysisData() {
    const [smtData, multiTF, ticker] = await Promise.all([
      this.fetchForSMT('5m'),
      this.fetchMultiTimeframe(),
      this.getCurrentPrice()
    ]);

    const atr = this.calculateATR(smtData.btc);

    return {
      btc: {
        candles5m: smtData.btc,
        multiTimeframe: multiTF,
        ticker
      },
      eth: {
        candles5m: smtData.eth
      },
      volatility: atr,
      timestamp: Date.now()
    };
  }
}

export default PriceDataFetcher;
