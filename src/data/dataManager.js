/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATA MANAGER - Cache historical data locally to avoid repeated API calls
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '../../data/cache');

export class DataManager {
  constructor() {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  getCacheFilename(symbol, timeframe, startDate, endDate) {
    const symbolClean = symbol.replace('/', '_');
    return path.join(CACHE_DIR, `${symbolClean}_${timeframe}_${startDate}_${endDate}.json`);
  }

  /**
   * Load data from cache if available
   */
  loadFromCache(symbol, timeframe, startDate, endDate) {
    const filename = this.getCacheFilename(symbol, timeframe, startDate, endDate);

    if (fs.existsSync(filename)) {
      console.log(`  📁 Loading ${symbol} ${timeframe} from cache...`);
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      console.log(`  ✓ Loaded ${data.length} candles from cache`);
      return data;
    }

    return null;
  }

  /**
   * Save data to cache
   */
  saveToCache(symbol, timeframe, startDate, endDate, data) {
    const filename = this.getCacheFilename(symbol, timeframe, startDate, endDate);
    fs.writeFileSync(filename, JSON.stringify(data));
    console.log(`  💾 Saved ${data.length} candles to cache`);
  }

  /**
   * Fetch from API
   */
  async fetchFromAPI(symbol, timeframe, since, limit = 1000) {
    const allCandles = [];
    let currentSince = since;

    while (allCandles.length < limit) {
      const candles = await this.exchange.fetchOHLCV(
        symbol,
        timeframe,
        currentSince,
        Math.min(500, limit - allCandles.length)
      );

      if (candles.length === 0) break;

      allCandles.push(...candles.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp,
        date: new Date(timestamp).toISOString(),
        open, high, low, close, volume
      })));

      currentSince = candles[candles.length - 1][0] + 1;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allCandles;
  }

  /**
   * Get historical data - from cache if available, otherwise fetch and cache
   */
  async getHistoricalData(symbol, timeframe, startDate, endDate, forceRefresh = false) {
    // Try cache first
    if (!forceRefresh) {
      const cached = this.loadFromCache(symbol, timeframe, startDate, endDate);
      if (cached) return cached;
    }

    // Fetch from API
    console.log(`  🌐 Fetching ${symbol} ${timeframe} from Binance API...`);
    const startTimestamp = new Date(startDate).getTime();
    const daysRequested = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));

    let candlesNeeded;
    switch (timeframe) {
      case '5m':
        candlesNeeded = Math.min(daysRequested * 24 * 12 + 5000, 250000);
        break;
      case '4h':
        candlesNeeded = Math.min(daysRequested * 6 + 500, 10000);
        break;
      case '1d':
        candlesNeeded = Math.min(daysRequested + 100, 1000);
        break;
      default:
        candlesNeeded = 50000;
    }

    const data = await this.fetchFromAPI(symbol, timeframe, startTimestamp, candlesNeeded);
    console.log(`  ✓ Fetched ${data.length} candles`);

    // Save to cache
    this.saveToCache(symbol, timeframe, startDate, endDate, data);

    return data;
  }

  /**
   * Get all required data for ETH13 backtest
   */
  async getETH13Data(startDate, endDate, forceRefresh = false) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    LOADING ETH13 DATA                              ');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const eth5m = await this.getHistoricalData('ETH/USDT', '5m', startDate, endDate, forceRefresh);
    const eth4h = await this.getHistoricalData('ETH/USDT', '4h', startDate, endDate, forceRefresh);
    const eth1d = await this.getHistoricalData('ETH/USDT', '1d', startDate, endDate, forceRefresh);
    const btc5m = await this.getHistoricalData('BTC/USDT', '5m', startDate, endDate, forceRefresh);

    console.log('\n✅ All data loaded!\n');

    return { eth5m, eth4h, eth1d, btc5m };
  }

  /**
   * List cached files
   */
  listCache() {
    const files = fs.readdirSync(CACHE_DIR);
    console.log('\n📁 Cached data files:');
    for (const file of files) {
      const stats = fs.statSync(path.join(CACHE_DIR, file));
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  - ${file} (${sizeMB} MB)`);
    }
    return files;
  }

  /**
   * Clear cache
   */
  clearCache() {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }
    console.log(`🗑️  Cleared ${files.length} cached files`);
  }
}

// CLI commands
const args = process.argv.slice(2);
if (args[0] === 'download') {
  const dm = new DataManager();
  const startDate = args[1] || '2024-01-01';
  const endDate = args[2] || '2025-12-31';
  dm.getETH13Data(startDate, endDate, true).catch(console.error);
} else if (args[0] === 'list') {
  const dm = new DataManager();
  dm.listCache();
} else if (args[0] === 'clear') {
  const dm = new DataManager();
  dm.clearCache();
}

export default DataManager;
