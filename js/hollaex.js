'use strict';

//  ---------------------------------------------------------------------------

const ccxt = require ('ccxt');
const { AuthenticationError, BadSymbol, BadRequest } = require ('ccxt/js/base/errors');
const { ArrayCache, ArrayCacheBySymbolById } = require ('./base/Cache');

//  ---------------------------------------------------------------------------

module.exports = class hollaex extends ccxt.hollaex {
    describe () {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchBalance': true,
                'watchTickers': false, // for now
                'watchMyTrades': false,
                'watchTrades': true,
                'watchOrderBook': true,
                'watchOrders': true,
                'watchOHLCV': false,
            },
            'urls': {
                'api': {
                    'ws': 'https://api.hollaex.com/stream',
                },
            },
            'options': {
                'watchBalance': {
                    'api-expires': '',
                },
                'watchOrders': {
                    'api-expires': '',
                },
            },
            'streaming': {
                'ping': this.ping,
            },
            'exceptions': {
                'ws': {
                    'exact': {
                        'Bearer or HMAC authentication required': BadSymbol, // { error: 'Bearer or HMAC authentication required' }
                        'Error: wrong input': BadRequest, // { error: 'Error: wrong input' }
                    },
                },
            },
        });
    }

    async watchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const messageHash = 'orderbook' + ':' + market['id'];
        const orderbook = await this.watchPublic (messageHash, params);
        return orderbook.limit (limit);
    }

    handleOrderBook (client, message) {
        //
        // {
        //     "topic":"orderbook",
        //     "action":"partial",
        //     "symbol":"ltc-usdt",
        //     "data":{
        //        "bids":[
        //           [104.29, 5.2264],
        //           [103.86,1.3629],
        //           [101.82,0.5942]
        //        ],
        //        "asks":[
        //           [104.81,9.5531],
        //           [105.54,0.6416],
        //           [106.18,1.4141],
        //           [112.43,0.6525],
        //           [114.4,0.3653],
        //           [116.59,0.0377],
        //           [118.67,0.3116],
        //           [120.64,0.2881],
        //           [122.84,0.3331],
        //           [135.11,0.01],
        //           [137.61,0.01],
        //           [140.11,0.01],
        //           [142.61,0.01],
        //           [145.12,0.01],
        //           [147.62,0.01],
        //           [154,0.0048],
        //           [300,0.0215],
        //           [500,1],
        //           [650,0.1],
        //           [1000,1]
        //        ],
        //        "timestamp":"2022-04-12T08:17:05.932Z"
        //     },
        //     "time":1649751425
        //  }
        //
        const marketId = this.safeString (message, 'symbol');
        const channel = this.safeString (message, 'topic');
        const market = this.safeMarket (marketId);
        const symbol = market['symbol'];
        const data = this.safeValue (message, 'data');
        let timestamp = this.safeString (data, 'timestamp');
        timestamp = this.parse8601 (timestamp);
        const snapshot = this.parseOrderBook (data, symbol, timestamp);
        let orderbook = undefined;
        if (!(symbol in this.orderbooks)) {
            orderbook = this.orderBook (snapshot);
            this.orderbooks[symbol] = orderbook;
        } else {
            orderbook = this.orderbooks[symbol];
            orderbook.reset (snapshot);
        }
        const messageHash = channel + ':' + marketId;
        client.resolve (orderbook, messageHash);
    }

    async watchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const messageHash = 'trade' + ':' + market['id'];
        const trades = await this.watchPublic (messageHash, params);
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleTrades (client, message) {
        //
        //   {
        //       topic: 'trade',
        //       action: 'partial',
        //       symbol: 'btc-usdt',
        //       data: [
        //         {
        //           size: 0.05145,
        //           price: 41977.9,
        //           side: 'buy',
        //           timestamp: '2022-04-11T09:40:10.881Z'
        //         },
        //         (...)
        //    }
        //
        const channel = this.safeString (message, 'topic');
        const marketId = this.safeString (message, 'symbol');
        const market = this.safeMarket (marketId);
        const symbol = market['symbol'];
        let stored = this.safeValue (this.trades, symbol);
        if (stored === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            stored = new ArrayCache (limit);
            this.trades[symbol] = stored;
        }
        const data = this.safeValue (message, 'data', []);
        const parsedTrades = this.parseTrades (data, market);
        for (let j = 0; j < parsedTrades.length; j++) {
            stored.append (parsedTrades[j]);
        }
        const messageHash = channel + ':' + marketId;
        client.resolve (stored, messageHash);
        client.resolve (stored, channel);
    }

    async watchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let messageHash = 'order';
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
            messageHash += ':' + market['id'];
        }
        const options = this.safeValue (this.options, 'watchOrders', {});
        let expiresString = this.safeString (options, 'api-expires');
        if (expiresString === undefined || expiresString.length === 0) {
            expiresString = this.getExpirationTime ();
            // we need to memoize these values to avoid generating a new url on each method execution
            // that would trigger a new connection on each received message
            this.options['watchOrders']['api-expires'] = expiresString;
        }
        const orders = await this.watchPrivate (messageHash, expiresString, params);
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    handleOrder (client, message, subscription = undefined) {
        //
        // {
        //     topic: 'order',
        //     action: 'insert',
        //     user_id: 155328,
        //     symbol: 'ltc-usdt',
        //     data: {
        //       symbol: 'ltc-usdt',
        //       side: 'buy',
        //       size: 0.05,
        //       type: 'market',
        //       price: 0,
        //       fee_structure: { maker: 0.1, taker: 0.1 },
        //       fee_coin: 'ltc',
        //       id: 'ce38fd48-b336-400b-812b-60c636454231',
        //       created_by: 155328,
        //       filled: 0.05,
        //       method: 'market',
        //       created_at: '2022-04-11T14:09:00.760Z',
        //       updated_at: '2022-04-11T14:09:00.760Z',
        //       status: 'filled'
        //     },
        //     time: 1649686140
        // }
        //
        const channel = this.safeString (message, 'topic');
        const marketId = this.safeString (message, 'symbol');
        const data = this.safeValue (message, 'data', {});
        // usually the first message is an empty array
        const dataLength = data.length;
        if (dataLength === 0) {
            return 0;
        }
        const parsed = this.parseOrder (data);
        if (this.orders === undefined) {
            const limit = this.safeInteger (this.options, 'ordersLimit', 1000);
            this.orders = new ArrayCacheBySymbolById (limit);
        }
        const orders = this.orders;
        orders.append (parsed);
        client.resolve (orders);
        // non-symbol specific
        client.resolve (orders, channel);
        const messageHash = channel + ':' + marketId;
        client.resolve (orders, messageHash);
    }

    async watchBalance (params = {}) {
        const messageHash = 'wallet';
        const options = this.safeValue (this.options, 'watchBalance', {});
        let expiresString = this.safeInteger (options, 'api-expires');
        if (expiresString === undefined || expiresString.length === 0) {
            expiresString = this.getExpirationTime ();
            // we need to memoize these values to avoid generating a new url on each method execution
            // that would trigger a new connection on each received message
            this.options['watchBalance']['api-expires'] = expiresString;
        }
        return await this.watchPrivate (messageHash, expiresString, params);
    }

    getExpirationTime () {
        const defaultValue = parseInt (this.timeout / 1000);
        const expires = this.sum (this.seconds (), defaultValue);
        const expiresString = expires.toString ();
        return expiresString;
    }

    handleBalance (client, message) {
        //
        // {
        //     topic: 'wallet',
        //     action: 'partial',
        //     user_id: 155328,
        //     data: {
        //       bch_balance: 0,
        //       bch_available: 0,
        //       xrp_balance: 0,
        //       xrp_available: 0,
        //       eth_balance: 0,
        //       eth_available: 0,
        //       usdt_balance: 18.94344188,
        //       usdt_available: 18.94344188,
        //       btc_balance: 0,
        //       btc_available: 0,
        //       xht_balance: 0,
        //       xht_available: 0,
        //       link_balance: 0,
        //       link_available: 0,
        //       ama_balance: 0,
        //       ama_available: 0,
        //       xlm_balance: 0,
        //       xlm_available: 0,
        //       xmr_balance: 0,
        //       xmr_available: 0,
        //       bnb_balance: 0,
        //       bnb_available: 0,
        //       trx_balance: 0,
        //       trx_available: 0,
        //       ada_balance: 0,
        //       ada_available: 0,
        //       dot_balance: 0,
        //       dot_available: 0,
        //       ltc_balance: 0.00005,
        //       ltc_available: 0.00005,
        //       uni_balance: 0,
        //       uni_available: 0,
        //       dai_balance: 0,
        //       dai_available: 0,
        //       xtz_balance: 0,
        //       xtz_available: 0,
        //       doge_balance: 0,
        //       doge_available: 0,
        //       axs_balance: 0,
        //       axs_available: 0,
        //       sol_balance: 0,
        //       sol_available: 0,
        //       avax_balance: 0,
        //       avax_available: 0,
        //       shib_balance: 0,
        //       shib_available: 0
        //     },
        //     time: 1649687396
        //   }
        //
        const messageHash = this.safeString (message, 'topic');
        const data = this.safeValue (message, 'data');
        const balanceKeys = Object.keys (data);
        const currencies = {};
        for (let i = 0; i < balanceKeys.length; i++) {
            const rawKey = balanceKeys[i];
            const keyParts = rawKey.split ('_');
            const currency = this.safeValue (keyParts, 0);
            currencies[currency] = true;
        }
        const currenciesKeys = Object.keys (currencies);
        for (let i = 0; i < currenciesKeys.length; i++) {
            const currencyId = currenciesKeys[i];
            const code = this.safeCurrencyCode (currencyId);
            const account = this.account ();
            const availableKey = currencyId + '_available';
            const totalKey = currencyId + '_balance';
            account['free'] = this.safeString (data, availableKey);
            account['total'] = this.safeString (data, totalKey);
            this.balance[code] = account;
            this.balance = this.safeBalance (this.balance);
        }
        client.resolve (this.balance, messageHash);
    }

    async watchPublic (messageHash, params = {}) {
        const url = this.urls['api']['ws'];
        const request = {
            'op': 'subscribe',
            'args': [ messageHash ],
        };
        const message = this.extend (request, params);
        return await this.watch (url, messageHash, message, messageHash);
    }

    async watchPrivate (messageHash, expires, params = {}) {
        this.checkRequiredCredentials ();
        const url = this.urls['api']['ws'];
        const auth = 'CONNECT' + '/stream' + expires;
        const signature = this.hmac (this.encode (auth), this.encode (this.secret));
        const authParams = {
            'api-key': this.apiKey,
            'api-signature': signature,
            'api-expires': expires,
        };
        const signedUrl = url + '?' + this.urlencode (authParams);
        const request = {
            'op': 'subscribe',
            'args': [ messageHash ],
        };
        const message = this.extend (request, params);
        return await this.watch (signedUrl, messageHash, message, messageHash);
    }

    handleErrorMessage (client, message) {
        //  { error: 'Bearer or HMAC authentication required' }
        //  { error: 'Error: wrong input' }
        const error = this.safeInteger (message, 'error');
        try {
            if (error !== undefined) {
                const feedback = this.id + ' ' + this.json (message);
                this.throwExactlyMatchedException (this.exceptions['ws']['exact'], error, feedback);
            }
        } catch (e) {
            if (e instanceof AuthenticationError) {
                return false;
            }
        }
        return message;
    }

    handleMessage (client, message) {
        // pong
        //
        // { message: 'pong' }
        //
        // trade
        //   {
        //       topic: 'trade',
        //       action: 'partial',
        //       symbol: 'btc-usdt',
        //       data: [
        //         {
        //           size: 0.05145,
        //           price: 41977.9,
        //           side: 'buy',
        //           timestamp: '2022-04-11T09:40:10.881Z'
        //         },
        //         (...)
        //    }
        // orderbook
        //    {
        //        topic: 'orderbook',
        //        action: 'partial',
        //        symbol: 'ltc-usdt',
        //        data: {
        //          bids: [ ],
        //          asks: [ ],
        //          timestamp: '2022-04-11T10:37:01.227Z'
        //        },
        //        time: 1649673421
        //    }
        // order
        //  {
        //      topic: 'order',
        //      action: 'insert',
        //      user_id: 155328,
        //      symbol: 'ltc-usdt',
        //      data: {
        //        symbol: 'ltc-usdt',
        //        side: 'buy',
        //        size: 0.05,
        //        type: 'market',
        //        price: 0,
        //        fee_structure: { maker: 0.1, taker: 0.1 },
        //        fee_coin: 'ltc',
        //        id: 'ce38fd48-b336-400b-812b-60c636454231',
        //        created_by: 155328,
        //        filled: 0.05,
        //        method: 'market',
        //        created_at: '2022-04-11T14:09:00.760Z',
        //        updated_at: '2022-04-11T14:09:00.760Z',
        //        status: 'filled'
        //      },
        //      time: 1649686140
        //  }
        // balance
        //   {
        //       topic: 'wallet',
        //       action: 'partial',
        //       user_id: 155328,
        //       data: { }
        //   }
        //
        if (!this.handleErrorMessage (client, message)) {
            return;
        }
        const content = this.safeString (message, 'message');
        if (content === 'pong') {
            this.handlePong (client, message);
            return;
        }
        const methods = {
            'trade': this.handleTrades,
            'orderbook': this.handleOrderBook,
            'order': this.handleOrder,
            'wallet': this.handleBalance,
        };
        const topic = this.safeValue (message, 'topic');
        const method = this.safeValue (methods, topic);
        if (method !== undefined) {
            method.call (this, client, message);
        }
    }

    ping (client) {
        // hollaex does not support built-in ws protocol-level ping-pong
        return { 'op': 'ping' };
    }

    handlePong (client, message) {
        client.lastPong = this.milliseconds ();
        return message;
    }
};
