## Hyperliquid-Binance Simple Trading Robot (module not integrated version)

### Main reference documents：

- hyperliquid-doc: https://hyperliquid.gitbook.io/hyperliquid-docs

- hyperliquid-sdk:https://github.com/nomeida/hyperliquid

- binance-doc: https://developers.binance.com/docs/zh-CN/binance-spot-api-docs

### **Related dependencies**

```js
 "dependencies": {
    "@binance/connector": "^3.6.1",
    "binance-api-node": "^0.12.9",
    "dotenv": "^17.2.0",
    "https-proxy-agent": "^7.0.6",
    "hyperliquid": "^1.7.6",
    "node-telegram-bot-api": "^0.66.0",
    "socks-proxy-agent": "^8.0.5",
    "web3": "^4.16.0",
    "ws": "^8.18.3"
  }
```

### **Notes:**

1. **bn's API does not support mainland China and the United States. Pay attention to the proxy settings and understanding of related parameters**
2. **Some operations that can be performed through the corresponding SDK can be performed through the related file connections I provide. If not, it is recommended to build native parameters to obtain data, such as http or axios for operation**

## Some other cases

- Get the average price and assets supported by Hyperliquid

```typescript
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, // testnet-true，mainnet-false
  walletAddress: ''
});

//Get mid price operation
// sdk.info.getAllMids().then(allMids => {
//   console.log('all perp mid price:', allMids);
// }).catch(err => {
//   console.error('get mid price error:', err);
// });
// sdk.info.getL2Book('BTC').then(book => {
//     console.log('BTC l2Book:', book);
// });

//Get assets supported by Hyperliquid (including contracts and corresponding spot information)
sdk.info.getAllAssets().then(assets => {
  console.log('all assets:', assets);
}).catch(err => {
  console.error('get all assets error:', err);
});
```

- Get the corresponding market depth

```typescript
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});
sdk.info.getL2Book('BTC-PERP').then(book => {
    const bids = book.levels[0];
    const asks = book.levels[1];
    console.log('long:', bids);
    console.log('short:', asks);
    console.log('top 5 long:', bids.slice(0, 5));
    console.log('top 5 short:', asks.slice(0, 5));
});
```

- The official SDK gave me some examples, and I made some modifications myself.

```typescript
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, // testnet-true，mainnet-false
  walletAddress: ''
});
sdk.info
  .getL2Book('BTC-PERP')
  .then(l2Book => {
    const bids = l2Book.levels[0];
    const asks = l2Book.levels[1];
    console.log('top 5 long:');
    bids.slice(0, 5).forEach((item, idx) => {
      console.log(`
	Level ${idx + 1}: Price = ${item.px} Quantity = ${item.sz} Number of pending orders = ${item.n}`);
    });
    console.log('top 5 short:');
    asks.slice(0, 5).forEach((item, idx) => {
      console.log(`
Level ${idx + 1}: Price = ${item.px} Quantity = ${item.sz} Number of pending orders = ${item.n}`);
    });
  })
  .catch(error => {
    console.error('Error getting L2 book:', error);
  });
```

## How to obtain hyperliquid spot information (SDK source code)

```typescript
import { SpotMeta, SpotClearinghouseState, SpotMetaAndAssetCtxs } from '../../types';
import { HttpApi } from '../../utils/helpers';
import { InfoType } from '../../types/constants';
import { SymbolConversion } from '../../utils/symbolConversion';

export class SpotInfoAPI {
  private httpApi: HttpApi;
  private symbolConversion: SymbolConversion;

  constructor(httpApi: HttpApi, symbolConversion: SymbolConversion) {
    this.httpApi = httpApi;
    this.symbolConversion = symbolConversion;
  }

  async getSpotMeta(rawResponse: boolean = false): Promise<SpotMeta> {
    const response = await this.httpApi.makeRequest({ type: InfoType.SPOT_META });
    return rawResponse
      ? (response as SpotMeta)
      : ((await this.symbolConversion.convertResponse(
          response,
          ['name', 'coin', 'symbol'],
          'SPOT'
        )) as SpotMeta);
  }

  async getSpotClearinghouseState(
    user: string,
    rawResponse: boolean = false
  ): Promise<SpotClearinghouseState> {
    const response = await this.httpApi.makeRequest({
      type: InfoType.SPOT_CLEARINGHOUSE_STATE,
      user: user,
    });
    return rawResponse
      ? (response as SpotClearinghouseState)
      : ((await this.symbolConversion.convertResponse(
          response,
          ['name', 'coin', 'symbol'],
          'SPOT'
        )) as SpotClearinghouseState);
  }

  async getSpotMetaAndAssetCtxs(rawResponse: boolean = false): Promise<SpotMetaAndAssetCtxs> {
    const response = await this.httpApi.makeRequest({ type: InfoType.SPOT_META_AND_ASSET_CTXS });
    return rawResponse
      ? (response as SpotMetaAndAssetCtxs)
      : ((await this.symbolConversion.convertResponse(response)) as SpotMetaAndAssetCtxs);
  }

  async getTokenDetails(tokenId: string, rawResponse: boolean = false): Promise<any> {
    const response = await this.httpApi.makeRequest(
      {
        type: InfoType.TOKEN_DETAILS,
        tokenId: tokenId,
      },
      20
    );

    return rawResponse ? response : await this.symbolConversion.convertResponse(response);
  }

  async getSpotDeployState(user: string, rawResponse: boolean = false): Promise<any> {
    const response = await this.httpApi.makeRequest(
      {
        type: InfoType.SPOT_DEPLOY_STATE,
        user: user,
      },
      20
    );
    return rawResponse ? response : await this.symbolConversion.convertResponse(response);
  }
}

```

- Get detailed information about the spot
  -  https://hypurrscan.io/token/0x649efea44690cf88d464f512bc7e2818 It is very necessary to have a detailed understanding of hyper operation and how to carry out detailed design. To be honest, this is the core competitiveness!

```typescript
const { Hyperliquid } = require('hyperliquid');

const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});
//Get spot metadata
sdk.info.spot
  .getSpotMeta()
  .then(spotMeta => {
    console.log(spotMeta);
  })
  .catch(error => {
    console.error('Error getting spot metadata:', error);
  });
```

- Get all the status information about the spot that the user owns

```typescript
const { Hyperliquid } = require('hyperliquid');

const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});

// Get spot clearinghouse state
sdk.info.spot
  .getSpotClearinghouseState('')
  .then(spotClearinghouseState => {
    console.log(spotClearinghouseState);
  })
  .catch(error => {
    console.error('Error getting spot clearinghouse state:', error);
  });
```

```typescript
const { Hyperliquid } = require('hyperliquid');

const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});

sdk.info.spot.getTokenDetails('').then(details => {
  console.log('coin detail:', details);
}).catch(err => {
  console.error('get coin detail error:', err);
});
```

- Get spot token details

![截屏2025-07-19 01.49.31](/Users/dongqing/Library/Application Support/typora-user-images/截屏2025-07-19 01.49.31.png)

## Hyperliquid-Perp

- **This is James Wayne's account**

![截屏2025-07-17 04.52.06](/Users/dongqing/Library/Application Support/typora-user-images/截屏2025-07-17 04.52.06.png)

- perp liquidation status

```typescript
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});
// Get user's perpetuals account summary
sdk.info.perpetuals
  .getClearinghouseState('')
  .then(clearinghouseState => {
    console.log(clearinghouseState);
  })
  .catch(error => {
    console.error('Error getting clearinghouse state:', error);
  });
```

- getFunding

```typescript
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});
const now = Date.now(); // millisecond
const eightHoursAgo = now - 8 * 60 * 60 * 1000; // 8h
//Getting eight hours here is actually a tariff operation performed through related operations (eight hours means returning eight items)
sdk.info.perpetuals.getFundingHistory('ATOM-PERP', eightHoursAgo, now).then(history => {
  console.log('ATOM-PERP past 8h FundingHistory:', history);
}).catch(err => {
  console.error('getFundingHistory error:', err);
});
//For the latest funding rate, just look at the first item.
sdk.info.perpetuals.getFundingHistory('ATOM-PERP', eightHoursAgo, now).then(history => {
    const latest = history[history.length - 1];
    console.log('latest funding rate:', latest);
 });
```

![截屏2025-07-17 05.11.13](/Users/dongqing/Library/Application Support/typora-user-images/截屏2025-07-19 01.54.00.png)

- Predicted  fundingRate

```typescript
const { Hyperliquid } = require('hyperliquid');


const sdk = new Hyperliquid({
  enableWs: false,
  privateKey: '',
  testnet: false, 
  walletAddress: ''
});

const now = Date.now(); 
const eightHoursAgo = now - 8 * 60 * 60 * 1000; 

sdk.info.perpetuals.getPredictedFundings().then(predicted => {
  predicted.forEach(([symbol, arr]) => {
    console.log(`coin symbol: ${symbol}`);
    arr.forEach(([platform, info]) => {
      console.log(`  platform: ${platform}`);
      console.log(`  Predicted  fundingRate: ${info.fundingRate}`);
      console.log(`  nextFundingTime: ${new Date(info.nextFundingTime).toLocaleString()}`);
      console.log(`  fundingIntervalHours(an hour): ${info.fundingIntervalHours}`);
    });
  });
}).catch(err => {
  console.error('Predicted  fundingRate error:', err);
});
```

## Automated trading operations on Hyperliquid

- Limit order

```typescript
const { Hyperliquid } = require('hyperliquid');

async function checkSupportedAssets() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '',
    testnet: true,
    walletAddress: '',
  });

  try {
    const mids = await sdk.info.getAllMids();
    console.log('支持的合约:', Object.keys(mids));
   
    const assets = await sdk.info.getAllAssets();
    console.log('所有资产:', assets);

  } catch (error) {
    console.error('查询资产失败:', error);
  }
}

checkSupportedAssets();

async function placeOrderExample() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '',
    testnet: true,
    walletAddress: '',
  });
  try {
    const orderParams = {
      coin: 'BTC-PERP',  // BTC-SPOT
      is_buy: true,
      sz: '0.001',
      limit_px: '50000',
      order_type: { limit: { tif: 'Gtc' } },
      reduce_only: false,
    };

    console.log('订单参数:', JSON.stringify(orderParams, null, 2));

    const orderResponse = await sdk.exchange.placeOrder(orderParams);
    console.log('下单成功:', orderResponse);

  } catch (error) {
    console.error('操作失败:', error.message);
  }
}

placeOrderExample();
```

- closePosition 

```typescript
const { Hyperliquid } = require('hyperliquid');

async function closePosition() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '',
    testnet: true,
    walletAddress: '',
  });

  try {

    const state = await sdk.info.perpetuals.getClearinghouseState('Your wallet address !!!');
    console.log('Current position:', state.assetPositions);

    const closeResponse = await sdk.custom.marketClose('BTC-PERP');
    console.log('Close position:', closeResponse);

    const newState = await sdk.info.perpetuals.getClearinghouseState('Your wallet address !!!');
    console.log('Close position and your position:', newState.assetPositions);

  } catch (error) {
    console.error('close position error:', error.message);
  }
}
closePosition();
```

- Pay attention to the related tag label operations added after the limit order like 'tif: 'Gtc''tif'

```typescript
const { Hyperliquid } = require('hyperliquid');

async function checkSupportedAssets() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '',
    testnet: true,
    walletAddress: '',
  });

  try {

    const mids = await sdk.info.getAllMids();
    console.log('suport perp:', Object.keys(mids));
    

    const assets = await sdk.info.getAllAssets();
    console.log('all assets:', assets);

  } catch (error) {
    console.error('get assets error:', error);
  }
}

checkSupportedAssets();

async function placeOrderExample() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '',
    testnet: true,
    walletAddress: '',
  });
  try {
    const orderParams = {
        coin: 'BTC-PERP',
        is_buy: true,
        sz: '0.001',
        limit_px: '118203',
        order_type: { limit: { tif: 'Gtc' } }, 
        reduce_only: false,
      };

    console.log('orderParams:', JSON.stringify(orderParams, null, 2));

    const orderResponse = await sdk.exchange.placeOrder(orderParams);
    console.log('success:', orderResponse);

  } catch (error) {
    console.error('failed:', error.message);
  }
}

placeOrderExample();
```

## Binance spot trading entry

- Pay attention to the timestamp to set and the corresponding apiKey operation understanding

```javascript
const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const apiKey = '';
const apiSecret = '';

const proxy = '';
const agent = new HttpsProxyAgent(proxy);

async function main() {

    const serverTimeRes = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent });
    const timestamp = serverTimeRes.data.serverTime;


    const params = [
        `timestamp=${timestamp}`,
        `recvWindow=5000`,
        `omitZeroBalances=true`
    ];
    const queryString = params.join('&');
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;


    axios.get(url, {
        headers: {
            'X-MBX-APIKEY': apiKey
        },
        httpsAgent: agent
    }).then(res => {
        console.log(res.data);
    }).catch(err => {
        console.error(err.response ? err.response.data : err);
    });
}

main();
```

Corrections and exchanges are welcome ;) I am a geek ! have fun!