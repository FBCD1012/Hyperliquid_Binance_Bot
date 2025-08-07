require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = process.env.PROXY;
let agent = null;
if (proxy) {
    try {
        agent = new HttpsProxyAgent(proxy);
        console.log('使用代理配置:', proxy);
    } catch (error) {
        console.warn('代理配置无效，将使用直接连接:', error.message);
    }
} else {
    console.log('未配置代理，使用直接连接');
}

// 查询单个币种详细信息
async function getCoinGeckoDetail(id = 'bitcoin') {
    try {
        const config = {
            url: `https://api.coingecko.com/api/v3/coins/${id}`,
            params: {
                localization: false,
                tickers: false,
                market_data: true,
                community_data: false,
                developer_data: false,
                sparkline: false
            }
        };
        if (agent) config.httpsAgent = agent;
        const res = await axios.get(config.url, config);
        const data = res.data;
        const m = data.market_data;
        console.log('-----------------------------');
        console.log(`币种: ${data.name} (${data.symbol.toUpperCase()})`);
        console.log('当前价格:', m.current_price.usd, 'USD');
        console.log('市值:', m.market_cap.usd ? `$${(m.market_cap.usd / 1e9).toFixed(2)}B` : 'N/A');
        console.log('流通供应量:', m.circulating_supply ? m.circulating_supply.toLocaleString() : 'N/A');
        console.log('总供应量:', m.total_supply ? m.total_supply.toLocaleString() : 'N/A');
        console.log('最大供应量:', m.max_supply ? m.max_supply.toLocaleString() : 'N/A');
        console.log('24小时涨跌幅:', m.price_change_percentage_24h ? `${m.price_change_percentage_24h.toFixed(2)}%` : 'N/A');
        console.log('-----------------------------');
    } catch (err) {
        console.error('CoinGecko 查询失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
    }
}

// 查询多个币种市值/流通量
async function getCoinGeckoMarkets(ids = ['bitcoin','ethereum','binancecoin']) {
    try {
        const config = {
            url: 'https://api.coingecko.com/api/v3/coins/markets',
            params: {
                vs_currency: 'usd',
                ids: ids.join(','),
                order: 'market_cap_desc',
                per_page: ids.length,
                page: 1,
                sparkline: false
            }
        };
        if (agent) config.httpsAgent = agent;
        const res = await axios.get(config.url, config);
        console.log('-----------------------------');
        console.log('多币种市值/流通量:');
        res.data.forEach(coin => {
            console.log(`${coin.name} (${coin.symbol.toUpperCase()}): 价格 $${coin.current_price}, 市值 $${(coin.market_cap/1e9).toFixed(2)}B, 流通量 ${coin.circulating_supply ? coin.circulating_supply.toLocaleString() : 'N/A'}, 总供应量: ${coin.total_supply ? coin.total_supply.toLocaleString() : 'N/A'}`);
        });
        console.log('-----------------------------');
    } catch (err) {
        console.error('CoinGecko Markets 查询失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
    }
}

async function main() {
    // 查询单个币种
    await getCoinGeckoDetail('bitcoin');
    // 查询多个币种
    await getCoinGeckoMarkets(['bitcoin','ethereum','binancecoin','cardano','polkadot']);
}

main(); 