require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = process.env.PROXY;
const agent = new HttpsProxyAgent(proxy);

async function main() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {
            httpsAgent: agent
        });
        // 只查找 BTCUSDT 交易对
        const btcusdt = res.data.symbols.find(item => item.symbol === 'BTCUSDT');
        if (btcusdt) {
            console.log('-----------------------------');
            console.log('交易对:', btcusdt.symbol);
            console.log('基础币种:', btcusdt.baseAsset);
            console.log('计价币种:', btcusdt.quoteAsset);
            console.log('最小下单量/价格等规则:', btcusdt.filters);
            console.log('支持的订单类型:', btcusdt.orderTypes);
            console.log('是否支持现货:', btcusdt.isSpotTradingAllowed);
            console.log('是否支持杠杆:', btcusdt.isMarginTradingAllowed);
        } else {
            console.log('未找到 BTCUSDT 交易对信息');
        }
    } catch (err) {
        console.error(err.response ? err.response.data : err);
    }
}

main();