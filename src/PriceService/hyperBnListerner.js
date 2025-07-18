require('dotenv').config();
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const TelegramBot = require('node-telegram-bot-api');
// Telegram 配置
const TELEGRAM_BOT_TOKEN =process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID =process.env.TELEGRAM_CHAT_ID;
const proxy =process.env.PROXY;
const agent = new HttpsProxyAgent(proxy);

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true,
    request: { agent: agent, timeout: 10000 }
});

// 发送消息到 Telegram
async function sendToTelegram(message) {
    try {
        const response = await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        console.log('消息发送成功:', response.text);
    } catch (error) {
        console.error('发送消息失败:', error.message);
    }
}

// Hyperliquid WebSocket
const hyperWs = new WebSocket('wss://api.hyperliquid-testnet.xyz/ws');
let binanceWs = null;

const symbolArg = process.argv[2] || 'ton';
const upperSymbol = symbolArg.toUpperCase();
const lowerSymbol = symbolArg.toLowerCase();

const hyperSymbol = `${upperSymbol}-PERP`;
const binanceSymbol = `${lowerSymbol}usdt@trade`;

// Binance WebSocket
function startBinanceWs() {
    binanceWs = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceSymbol}`, {
        agent: agent,
        handshakeTimeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    binanceWs.on('message', (data) => {
        try {
            const json = JSON.parse(data);
            const price = json.p;
            if (price && price !== binancePrice) {
                binancePrice = price;
                //console.log('Binance 现货:', binancePrice, '$');
                trySendToTelegram();
            }
        } catch (e) {
            console.error('Binance 解析失败:', e);
        }
    });

    binanceWs.on('error', (err) => {
        console.error('❌ Binance Error:', err.message);
        setTimeout(() => {
            startBinanceWs();
        }, 5000);
    });

    binanceWs.on('close', () => {
        console.warn('Binance WebSocket 已关闭，5秒后重连...');
        setTimeout(() => {
            startBinanceWs();
        }, 5000);
    });
}

// 启动
startBinanceWs();

let hyperMidPrice = null;
let binancePrice = null;

// 订阅 Hyperliquid mid price
hyperWs.on('open', () => {
    hyperWs.send(JSON.stringify({
        method: "subscribe",
        subscription: { type: "allMids" }
    }));
});

let pendingMsg = null;

let lastFeeRate = 'N/A';

async function updateFeeRate() {
    try {
        const Hyperliquid = require('hyperliquid').Hyperliquid;
        const sdk = new Hyperliquid({
            enableWs: false,
            privateKey: process.env.HL_PRIVATE_KEY,
            testnet: false,
            walletAddress: process.env.HL_WALLET
        });
        const now = Date.now();
        const eightHoursAgo = now - 8 * 60 * 60 * 1000;
        const history = await sdk.info.perpetuals.getFundingHistory(hyperSymbol, eightHoursAgo, now);
        const latest = history[history.length - 1];
        lastFeeRate = latest ? latest.fundingRate : 'N/A';
    } catch (e) {
        lastFeeRate = '获取失败';
    }
}

// 定时每5分钟异步更新一次feeRate（也可以在价格变化时触发）
setInterval(updateFeeRate, 5 * 60 * 1000);
updateFeeRate(); // 启动时先获取一次

async function trySendToTelegram() {
    if (hyperMidPrice && binancePrice) {
        const diff = (parseFloat(hyperMidPrice) - parseFloat(binancePrice));
        const basisRate = ((parseFloat(hyperMidPrice) - parseFloat(binancePrice)) / parseFloat(binancePrice) * 100).toFixed(5);
        let feeRatePercent = 'N/A';
        if (lastFeeRate && !isNaN(lastFeeRate)) {
            feeRatePercent = (parseFloat(lastFeeRate) * 100).toFixed(6) + ' %';
        }
        pendingMsg =
`🪙 Coin Name: ${upperSymbol}
💎 Hyper Perp Price: ${hyperMidPrice} $
🏦 Binance Spot Price:    ${binancePrice} $
——————————————
📊 Price Diff: ${diff} $
📈 Basis Rate: ${basisRate} %
💰 Funding Rate: ${feeRatePercent}`;
    }
}

// 定时器，每10秒推送一次最新的
setInterval(() => {
    if (pendingMsg) {
        sendToTelegram(pendingMsg);
        console.log(pendingMsg);
        pendingMsg = null;
    }
}, 10000); // 10秒

// Hyperliquid mid price 监听
hyperWs.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.channel === 'allMids' && msg.data && msg.data.mids) {
            const mids = msg.data.mids;
            // 动态查找合约
            const key = Object.keys(mids).find(k => k.toUpperCase().includes(upperSymbol));
            if (key) {
                const midPrice = mids[key];
                if (midPrice !== hyperMidPrice) {
                    hyperMidPrice = midPrice;
                    //console.log('Hyperliquid mid price:', hyperMidPrice, '$');
                    trySendToTelegram();
                }
            }
        }
    } catch (e) {
        console.error('Hyperliquid 解析失败:', e);
    }
});

process.on('uncaughtException', (err) => {
    console.error('未捕获异常:', err);
});