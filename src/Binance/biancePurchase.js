require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const apiKey =process.env.API_KEY;
const apiSecret =process.env.API_SECRET;
const proxy = process.env.PROXY;
const agent = new HttpsProxyAgent(proxy);

async function main() {
    // 1. 获取币安服务器时间
    const serverTimeRes = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent });
    const timestamp = serverTimeRes.data.serverTime;
    // 2. 拼接参数并签名
    const params = [
        `timestamp=${timestamp}`,
        `recvWindow=5000`,
        `omitZeroBalances=true`
    ];
    const queryString = params.join('&');
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
    // 3. 发起请求
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