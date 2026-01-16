/**
 * Polymarket Client
 *
 * Interacts with Polymarket's CLOB (Central Limit Order Book) API
 * for trading Bitcoin Up/Down daily markets
 *
 * API Documentation: https://docs.polymarket.com
 */

import axios from 'axios';
import { ethers } from 'ethers';
import { CONFIG } from '../../config/settings.js';

export class PolymarketClient {
  constructor(privateKey) {
    this.baseUrl = CONFIG.POLYMARKET.API_URL;
    this.gammaUrl = CONFIG.POLYMARKET.GAMMA_URL;
    this.privateKey = privateKey;

    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey);
      this.address = this.wallet.address;
    }

    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Search for Bitcoin Up/Down markets
   */
  async findBTCMarkets() {
    try {
      // Search for Bitcoin markets on Gamma API
      const response = await this.httpClient.get(`${this.gammaUrl}/markets`, {
        params: {
          active: true,
          closed: false,
          limit: 100
        }
      });

      const markets = response.data;

      // Filter for Bitcoin Up/Down daily markets
      const btcMarkets = markets.filter(market => {
        const question = market.question?.toLowerCase() || '';
        const description = market.description?.toLowerCase() || '';

        return (
          (question.includes('bitcoin') || question.includes('btc')) &&
          (question.includes('up or down') || question.includes('above') || question.includes('below'))
        );
      });

      return btcMarkets.map(market => this.parseMarket(market));

    } catch (error) {
      console.error('Error fetching markets:', error.message);
      throw error;
    }
  }

  /**
   * Parse market data into standardized format
   */
  parseMarket(rawMarket) {
    const outcomes = rawMarket.outcomes || ['Yes', 'No'];
    const prices = rawMarket.outcomePrices || [0.5, 0.5];

    return {
      id: rawMarket.id,
      conditionId: rawMarket.conditionId,
      question: rawMarket.question,
      description: rawMarket.description,
      endDate: rawMarket.endDate,
      endDateISO: new Date(rawMarket.endDate).toISOString(),

      // Outcomes
      outcomes: {
        yes: {
          token: outcomes[0],
          price: parseFloat(prices[0]),
          tokenId: rawMarket.clobTokenIds?.[0]
        },
        no: {
          token: outcomes[1],
          price: parseFloat(prices[1]),
          tokenId: rawMarket.clobTokenIds?.[1]
        }
      },

      // Liquidity info
      volume: rawMarket.volume,
      liquidity: rawMarket.liquidity,

      // Time info
      hoursUntilExpiry: this.calculateHoursUntilExpiry(rawMarket.endDate),

      // Tradeable check
      isTradeable: this.isMarketTradeable(rawMarket)
    };
  }

  /**
   * Calculate hours until market expiry
   */
  calculateHoursUntilExpiry(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    return (end - now) / (1000 * 60 * 60);
  }

  /**
   * Check if market meets our trading criteria
   */
  isMarketTradeable(market) {
    const hoursUntil = this.calculateHoursUntilExpiry(market.endDate);

    return (
      hoursUntil >= CONFIG.FILTERS.POLYMARKET.MIN_HOURS_BEFORE_EXPIRY &&
      hoursUntil <= CONFIG.FILTERS.POLYMARKET.MAX_HOURS_BEFORE_EXPIRY &&
      market.active &&
      !market.closed
    );
  }

  /**
   * Find the best BTC market for today
   */
  async findTodaysBTCMarket() {
    const markets = await this.findBTCMarkets();

    // Find daily "Up or Down" market for today/tomorrow
    const dailyMarkets = markets.filter(m => {
      const question = m.question.toLowerCase();
      return question.includes('up or down') && m.isTradeable;
    });

    if (dailyMarkets.length === 0) {
      return {
        found: false,
        reason: 'No tradeable BTC daily markets found'
      };
    }

    // Sort by hours until expiry (prefer closer to optimal window)
    dailyMarkets.sort((a, b) => {
      const aOptimal = Math.abs(a.hoursUntilExpiry - 12);
      const bOptimal = Math.abs(b.hoursUntilExpiry - 12);
      return aOptimal - bOptimal;
    });

    const bestMarket = dailyMarkets[0];

    return {
      found: true,
      market: bestMarket,
      allMarkets: dailyMarkets
    };
  }

  /**
   * Get market order book
   */
  async getOrderBook(tokenId) {
    try {
      const response = await this.httpClient.get(`${this.baseUrl}/book`, {
        params: { token_id: tokenId }
      });

      return {
        bids: response.data.bids || [],
        asks: response.data.asks || [],
        spread: this.calculateSpread(response.data)
      };

    } catch (error) {
      console.error('Error fetching order book:', error.message);
      throw error;
    }
  }

  /**
   * Calculate bid-ask spread
   */
  calculateSpread(orderBook) {
    const bestBid = orderBook.bids?.[0]?.price || 0;
    const bestAsk = orderBook.asks?.[0]?.price || 1;

    return {
      bid: bestBid,
      ask: bestAsk,
      spreadPercent: ((bestAsk - bestBid) / bestBid) * 100,
      mid: (bestBid + bestAsk) / 2
    };
  }

  /**
   * Check if odds are within acceptable range
   */
  checkOddsAcceptable(price, direction) {
    // If we want UP (buy YES), price should be in ideal range
    // If we want DOWN (buy NO), we're buying at (1 - YES price)

    const effectivePrice = direction === 'UP' ? price : (1 - price);

    const { MIN_ODDS_PRICE, MAX_ODDS_PRICE, IDEAL_ODDS_RANGE } = CONFIG.POLYMARKET;

    if (effectivePrice < MIN_ODDS_PRICE) {
      return {
        acceptable: false,
        reason: `Price too low (${effectivePrice.toFixed(3)}) - market strongly disagrees`
      };
    }

    if (effectivePrice > MAX_ODDS_PRICE) {
      return {
        acceptable: false,
        reason: `Price too high (${effectivePrice.toFixed(3)}) - poor risk/reward`
      };
    }

    const isIdeal = effectivePrice >= IDEAL_ODDS_RANGE[0] &&
                    effectivePrice <= IDEAL_ODDS_RANGE[1];

    return {
      acceptable: true,
      isIdeal,
      effectivePrice,
      potentialReturn: (1 / effectivePrice) - 1
    };
  }

  /**
   * Prepare order for execution
   */
  prepareOrder(market, direction, amount) {
    // direction: 'UP' = buy YES, 'DOWN' = buy NO

    const outcome = direction === 'UP' ? market.outcomes.yes : market.outcomes.no;
    const price = outcome.price;

    // Calculate shares to buy
    const shares = amount / price;

    return {
      market,
      direction,
      outcome: direction === 'UP' ? 'YES' : 'NO',
      tokenId: outcome.tokenId,
      price,
      amount,
      shares,
      potentialPayout: shares, // Each share pays $1 if correct
      potentialProfit: shares - amount,
      breakEvenPrice: amount / shares
    };
  }

  /**
   * Execute market order (placeholder - needs Polymarket SDK integration)
   *
   * NOTE: Actual execution requires:
   * 1. Polymarket SDK / py-clob-client
   * 2. Wallet signature
   * 3. USDC approval
   */
  async executeOrder(order) {
    console.log('═══════════════════════════════════════════════════');
    console.log('ORDER EXECUTION REQUEST');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Market: ${order.market.question}`);
    console.log(`Direction: ${order.direction} (${order.outcome})`);
    console.log(`Amount: $${order.amount.toFixed(2)}`);
    console.log(`Price: ${order.price.toFixed(4)}`);
    console.log(`Shares: ${order.shares.toFixed(4)}`);
    console.log(`Potential Payout: $${order.potentialPayout.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════');

    // TODO: Integrate with Polymarket SDK for actual execution
    // This requires:
    // 1. npm install @polymarket/clob-client
    // 2. Setting up proper authentication
    // 3. USDC approval transaction

    return {
      success: false,
      reason: 'SIMULATION MODE - Actual execution not implemented',
      order
    };
  }

  /**
   * Get account balance (placeholder)
   */
  async getBalance() {
    // TODO: Implement actual balance check
    return {
      usdc: 0,
      positions: []
    };
  }

  /**
   * Get open positions
   */
  async getPositions() {
    // TODO: Implement actual position fetching
    return [];
  }
}

export default PolymarketClient;
