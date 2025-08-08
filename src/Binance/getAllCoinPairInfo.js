const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = 'http://127.0.0.1:7897'; // 例如 'http://127.0.0.1:7897'
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

async function getFuturesExchangeInfo() {
    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    const res = await axios.get(url, agent ? { httpsAgent: agent } : {});
    const symbolsArr = res.data.symbols.map(item => item.symbol);
    console.log('所有合约交易对数组:', symbolsArr);
    console.log('合约交易对总数:', symbolsArr.length);
}

getFuturesExchangeInfo();