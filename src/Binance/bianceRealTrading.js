require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');


const apiKey =process.env.API_KEY;
const apiSecret =process.env.API_SECRET;

const proxy = process.env.PROXY;
const agent = new HttpsProxyAgent(proxy);

async function buyBtcUsdt() {
    // 1. 获取服务器时间
    const serverTimeRes = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent });
    const timestamp = serverTimeRes.data.serverTime;
    // 2. 构造市价买单参数
    const params = [
        `symbol=BTCUSDT`,
        `side=BUY`,
        `type=MARKET`,
        `quantity=0.00005`,
        `timestamp=${timestamp}`,
        `recvWindow=5000`
    ];
    const queryString = params.join('&');
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    // 3. 发送下单请求
    const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
    try {
        const res = await axios.post(url, null, {
            headers: {
                'X-MBX-APIKEY': apiKey
            },
            httpsAgent: agent
        });
        console.log('买单下单成功:', res.data);
    } catch (err) {
        console.error('买单下单失败:', err.response ? err.response.data : err);
    }
}

async function sellBtcUsdt() {
    // 1. 获取服务器时间
    const serverTimeRes = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent });
    const timestamp = serverTimeRes.data.serverTime;
    // 2. 构造市价卖单参数
    const params = [
        `symbol=BTCUSDT`,
        `side=SELL`,
        `type=MARKET`,
        `quantity=0.0001`,
        `timestamp=${timestamp}`,
        `recvWindow=5000`
    ];
    const queryString = params.join('&');
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    // 3. 发送下单请求
    const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
    try {
        const res = await axios.post(url, null, {
            headers: {
                'X-MBX-APIKEY': apiKey
            },
            httpsAgent: agent
        });
        console.log('卖单下单成功:', res.data);
    } catch (err) {
        console.error('卖单下单失败:', err.response ? err.response.data : err);
    }
}

// 默认只执行买单，如需卖单请调用 sellBtcUsdt()
//buyBtcUsdt();
 sellBtcUsdt();
