# -*- coding: utf-8 -*-

# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

from ccxt.async_support.binance import binance
from ccxt.base.errors import BadRequest


class binancecoinm(binance):

    def describe(self):
        return self.deep_extend(super(binancecoinm, self).describe(), {
            'id': 'binancecoinm',
            'name': 'Binance COIN-M',
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/117738721-668c8d80-b205-11eb-8c49-3fad84c4a07f.jpg',
            },
            'options': {
                'defaultType': 'delivery',
                'leverageBrackets': None,
            },
            'has': {
                'fetchPositions': True,
                'fetchIsolatedPositions': True,
                'fetchFundingRate': True,
                'fetchFundingHistory': True,
                'setLeverage': True,
                'setMode': True,
            },
            # https://www.binance.com/en/fee/deliveryFee
            'fees': {
                'trading': {
                    'tierBased': True,
                    'percentage': True,
                    'taker': self.parse_number('0.000500'),
                    'maker': self.parse_number('0.000100'),
                    'tiers': {
                        'taker': [
                            [self.parse_number('0'), self.parse_number('0.000500')],
                            [self.parse_number('250'), self.parse_number('0.000450')],
                            [self.parse_number('2500'), self.parse_number('0.000400')],
                            [self.parse_number('7500'), self.parse_number('0.000300')],
                            [self.parse_number('22500'), self.parse_number('0.000250')],
                            [self.parse_number('50000'), self.parse_number('0.000240')],
                            [self.parse_number('100000'), self.parse_number('0.000240')],
                            [self.parse_number('200000'), self.parse_number('0.000240')],
                            [self.parse_number('400000'), self.parse_number('0.000240')],
                            [self.parse_number('750000'), self.parse_number('0.000240')],
                        ],
                        'maker': [
                            [self.parse_number('0'), self.parse_number('0.000100')],
                            [self.parse_number('250'), self.parse_number('0.000080')],
                            [self.parse_number('2500'), self.parse_number('0.000050')],
                            [self.parse_number('7500'), self.parse_number('0.0000030')],
                            [self.parse_number('22500'), self.parse_number('0')],
                            [self.parse_number('50000'), self.parse_number('-0.000050')],
                            [self.parse_number('100000'), self.parse_number('-0.000060')],
                            [self.parse_number('200000'), self.parse_number('-0.000070')],
                            [self.parse_number('400000'), self.parse_number('-0.000080')],
                            [self.parse_number('750000'), self.parse_number('-0.000090')],
                        ],
                    },
                },
            },
        })

    async def fetch_trading_fees(self, params={}):
        await self.load_markets()
        marketSymbols = list(self.markets.keys())
        fees = {}
        accountInfo = await self.dapiPrivateGetAccount(params)
        #
        # {
        #      "canDeposit": True,
        #      "canTrade": True,
        #      "canWithdraw": True,
        #      "feeTier": 2,
        #      "updateTime": 0
        #      ...
        #  }
        #
        feeTier = self.safe_integer(accountInfo, 'feeTier')
        feeTiers = self.fees['trading']['tiers']
        maker = feeTiers['maker'][feeTier][1]
        taker = feeTiers['taker'][feeTier][1]
        for i in range(0, len(marketSymbols)):
            symbol = marketSymbols[i]
            fees[symbol] = {
                'info': {
                    'feeTier': feeTier,
                },
                'symbol': symbol,
                'maker': maker,
                'taker': taker,
            }
        return fees

    async def transfer_in(self, code, amount, params={}):
        # transfer from spot wallet to coinm futures wallet
        return await self.futuresTransfer(code, amount, 3, params)

    async def transfer_out(self, code, amount, params={}):
        # transfer from coinm futures wallet to spot wallet
        return await self.futuresTransfer(code, amount, 4, params)

    async def fetch_funding_rate(self, symbol, params={}):
        await self.load_markets()
        market = self.market(symbol)
        request = {
            'symbol': market['id'],
        }
        response = await self.dapiPublicGetPremiumIndex(self.extend(request, params))
        #
        #     [
        #       {
        #         "symbol": "ETHUSD_PERP",
        #         "pair": "ETHUSD",
        #         "markPrice": "2452.47558343",
        #         "indexPrice": "2454.04584679",
        #         "estimatedSettlePrice": "2464.80622965",
        #         "lastFundingRate": "0.00004409",
        #         "interestRate": "0.00010000",
        #         "nextFundingTime": "1621900800000",
        #         "time": "1621875158012"
        #       }
        #     ]
        #
        return self.parse_funding_rate(response[0])

    async def fetch_funding_rates(self, symbols=None, params={}):
        await self.load_markets()
        response = await self.dapiPublicGetPremiumIndex(params)
        result = []
        for i in range(0, len(response)):
            entry = response[i]
            parsed = self.parse_funding_rate(entry)
            result.append(parsed)
        return self.filter_by_array(result, 'symbol', symbols)

    async def load_leverage_brackets(self, reload=False, params={}):
        await self.load_markets()
        # by default cache the leverage bracket
        # it contains useful stuff like the maintenance margin and initial margin for positions
        if (self.options['leverageBrackets'] is None) or (reload):
            response = await self.dapiPrivateV2GetLeverageBracket(params)
            self.options['leverageBrackets'] = {}
            for i in range(0, len(response)):
                entry = response[i]
                marketId = self.safe_string(entry, 'symbol')
                symbol = self.safe_symbol(marketId)
                brackets = self.safe_value(entry, 'brackets')
                result = []
                for j in range(0, len(brackets)):
                    bracket = brackets[j]
                    # we use floats here internally on purpose
                    qtyFloor = self.safe_float(bracket, 'qtyFloor')
                    maintenanceMarginPercentage = self.safe_string(bracket, 'maintMarginRatio')
                    result.append([qtyFloor, maintenanceMarginPercentage])
                self.options['leverageBrackets'][symbol] = result
        return self.options['leverageBrackets']

    async def fetch_positions(self, symbols=None, params={}):
        await self.load_markets()
        await self.load_leverage_brackets()
        account = await self.dapiPrivateGetAccount(params)
        result = self.parse_account_positions(account)
        return self.filter_by_array(result, 'symbol', symbols, False)

    async def fetch_isolated_positions(self, symbol=None, params={}):
        # only supported in usdm futures
        await self.load_markets()
        await self.load_leverage_brackets()
        request = {}
        market = None
        if symbol is not None:
            market = self.market(symbol)
            # not the unified id here
            request['pair'] = market['info']['pair']
        response = await self.dapiPrivateGetPositionRisk(self.extend(request, params))
        if symbol is None:
            result = []
            for i in range(0, len(response)):
                parsed = self.parse_position_risk(response[i], market)
                if parsed['marginType'] == 'isolated':
                    result.append(parsed)
            return result
        else:
            return self.parse_position_risk(self.safe_value(response, 0), market)

    async def fetch_funding_history(self, symbol=None, since=None, limit=None, params={}):
        await self.load_markets()
        market = None
        # "TRANSFER"，"WELCOME_BONUS", "REALIZED_PNL"，"FUNDING_FEE", "COMMISSION" and "INSURANCE_CLEAR"
        request = {
            'incomeType': 'FUNDING_FEE',
        }
        if symbol is not None:
            market = self.market(symbol)
            request['symbol'] = market['id']
        if since is not None:
            request['startTime'] = since
        if limit is not None:
            request['limit'] = limit
        response = await self.dapiPrivateGetIncome(self.extend(request, params))
        return self.parse_incomes(response, market, since, limit)

    async def set_leverage(self, symbol, leverage, params={}):
        # WARNING: THIS WILL INCREASE LIQUIDATION PRICE FOR OPEN ISOLATED LONG POSITIONS
        # AND DECREASE LIQUIDATION PRICE FOR OPEN ISOLATED SHORT POSITIONS
        if (leverage < 1) or (leverage > 125):
            raise BadRequest(self.id + ' leverage should be between 1 and 125')
        await self.load_markets()
        market = self.market(symbol)
        request = {
            'symbol': market['id'],
            'leverage': leverage,
        }
        return await self.dapiPrivatePostLeverage(self.extend(request, params))

    async def set_margin_mode(self, symbol, marginType, params={}):
        #
        # {"code": -4048 , "msg": "Margin type cannot be changed if there exists position."}
        #
        # or
        #
        # {"code": 200, "msg": "success"}
        #
        marginType = marginType.upper()
        if (marginType != 'ISOLATED') and (marginType != 'CROSSED'):
            raise BadRequest(self.id + ' marginType must be either isolated or crossed')
        await self.load_markets()
        market = self.market(symbol)
        request = {
            'symbol': market['id'],
            'marginType': marginType,
        }
        return await self.dapiPrivatePostMarginType(self.extend(request, params))
