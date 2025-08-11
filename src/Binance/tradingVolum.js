const WebSocket = require('ws');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const path = require('path');
const fs = require('fs');



const proxy = 'http://127.0.0.1:7897';
const agent = new HttpsProxyAgent(proxy);

// Telegram Bot 配置
const TELEGRAM_BOT_TOKEN ='8375668476:AAHhAhNRkvZl_x2JxiQFi1EAY52lKIDPCkw';
const TELEGRAM_CHAT_ID ='-1002642354005';

// Telegram Bot 实例
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: false,
    request: { agent: agent, timeout: 10000 }
});

// 发送消息到 Telegram
async function sendToTelegram(message) {
    try {
        // 检查配置是否有效
        if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_bot_token_here' || 
            !TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'your_chat_id_here') {
            console.log('⚠️ Telegram配置未设置，跳过发送');
            return;
        }
        
        const response = await bot.sendMessage(TELEGRAM_CHAT_ID, message, { 
            disable_web_page_preview: true
        });
        console.log('✅ Telegram消息发送成功');
    } catch (error) {
        console.error('❌ Telegram发送失败:', error.message);
        console.error('错误详情:', error);
    }
}

// Telegram 消息队列和限速机制
const telegramQueue = [];
let isProcessingTelegramQueue = false;
let lastTelegramSendTime = 0;
const TELEGRAM_RATE_LIMIT = 1500; // 1.5秒间隔，更保守的限速

// 消息去重缓存（避免短时间内重复发送相同内容）
const messageDeduplicationCache = new Map();
const DEDUPLICATION_WINDOW = 60000; // 1分钟内不重复发送相同消息

// 处理Telegram消息队列
async function processTelegramQueue() {
    if (isProcessingTelegramQueue || telegramQueue.length === 0) {
        return;
    }
    
    isProcessingTelegramQueue = true;
    
    // 使用信号量控制并发发送
    const telegramSemaphore = new Semaphore(3); // 最多3个并发发送
    const queueItems = [...telegramQueue]; // 复制队列，避免并发修改
    telegramQueue.length = 0; // 清空原队列
    
    console.log(`📤 开始处理 ${queueItems.length} 条Telegram消息...`);
    
    // 并行处理消息，但控制并发数
    const messagePromises = queueItems.map(async (message) => {
        return telegramSemaphore.acquire().then(async (release) => {
            try {
                const now = Date.now();
                const timeSinceLastSend = now - lastTelegramSendTime;
                
                // 如果距离上次发送时间不足限制，则等待
                if (timeSinceLastSend < TELEGRAM_RATE_LIMIT) {
                    const waitTime = TELEGRAM_RATE_LIMIT - timeSinceLastSend;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                // 检查消息去重
                const messageHash = hashMessage(message);
                const lastSentTime = messageDeduplicationCache.get(messageHash);
                
                if (lastSentTime && (now - lastSentTime < DEDUPLICATION_WINDOW)) {
                    console.log('🔄 跳过重复消息（1分钟内已发送过）');
                    release();
                    return { success: false, reason: 'duplicate' };
                }
                
                await sendToTelegram(message);
                lastTelegramSendTime = Date.now();
                messageDeduplicationCache.set(messageHash, now);
                
                release();
                return { success: true };
                
            } catch (error) {
                release();
                console.error('❌ 队列消息发送失败:', error.message);
                
                // 如果是429错误，等待更长时间
                if (error.message.includes('429')) {
                    console.log('⏳ 遇到速率限制，等待10秒后重试...');
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
                
                return { success: false, error: error.message };
            }
        });
    });
    
    // 等待所有消息处理完成
    const results = await Promise.allSettled(messagePromises);
    let successCount = 0;
    let failCount = 0;
    let duplicateCount = 0;
    
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            const { success, reason, error } = result.value;
            if (success) {
                successCount++;
            } else if (reason === 'duplicate') {
                duplicateCount++;
            } else {
                failCount++;
                console.error('消息发送失败:', error);
            }
        } else {
            failCount++;
            console.error('消息处理异常:', result.reason);
        }
    });
    
    // 清理过期的去重缓存
    const now = Date.now();
    for (const [hash, timestamp] of messageDeduplicationCache.entries()) {
        if (now - timestamp > DEDUPLICATION_WINDOW) {
            messageDeduplicationCache.delete(hash);
        }
    }
    
    console.log(`📤 Telegram消息处理完成: ${successCount} 个成功, ${duplicateCount} 个重复, ${failCount} 个失败`);
    
    isProcessingTelegramQueue = false;
    
    // 如果还有失败的消息，可以考虑重新加入队列
    if (failCount > 0 && queueItems.length > 0) {
        console.log(`⚠️ 有 ${failCount} 条消息发送失败，请检查网络连接`);
    }
}

// 简单的消息哈希函数
function hashMessage(message) {
    return message.replace(/[0-9]/g, '').replace(/\s+/g, '').substring(0, 100);
}

// 将消息添加到队列
function enqueueTelegramMessage(message) {
    telegramQueue.push(message);
    console.log(`📝 消息已加入队列，当前队列长度: ${telegramQueue.length}`);
    processTelegramQueue();
}

// 已完成K线告警去重（每根K线只推一次）
const lastCompletedAlertKeyBySymbol = new Map();

// 全局 axios 实例
const axiosInstance = axios.create({ httpsAgent: agent });

// 获取合约交易规则和上线时间
async function getContractTradingRules(symbol) {
    try {
        const res = await axiosInstance.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const contract = res.data.symbols.find(item => item.symbol === symbol);
        
        if (contract) {
            return {
                symbol: contract.symbol,
                onboardDate: contract.onboardDate,
                status: contract.status,
                contractType: contract.contractType
            };
        }
        return null;
    } catch (err) {
        console.error(`获取 ${symbol} 合约信息失败:`, err.message);
        return null;
    }
}

// 获取当前持仓量信息
async function getCurrentOpenInterest(symbol) {
    try {
        const res = await axiosInstance.get('https://fapi.binance.com/futures/data/openInterestHist', {
            params: {
                symbol: symbol,
                period: '5m',
                limit: 1
            }
        });
        
        if (res.data && res.data.length > 0) {
            const latestData = res.data[0];
            return {
                timestamp: latestData.timestamp,
                openInterest: latestData.sumOpenInterest,
                openInterestValue: latestData.sumOpenInterestValue
            };
        }
        return null;
    } catch (err) {
        console.error(`获取 ${symbol} 持仓量信息失败:`, err.message);
        return null;
    }
}

// 获取币种详细信息（合约上线时间 + 持仓量）
async function getTokenDetails(symbol) {
    try {
        const [contractInfo, openInterest] = await Promise.all([
            getContractTradingRules(symbol),
            getCurrentOpenInterest(symbol)
        ]);
        
        return {
            symbol,
            contractInfo,
            openInterest,
            timestamp: new Date().toLocaleString()
        };
    } catch (error) {
        console.error(`获取 ${symbol} 详细信息失败:`, error.message);
        return null;
    }
}

// 缓存币种详细信息（5分钟过期）
const tokenDetailsCache = new Map();

// 获取币种详细信息（带缓存）
async function getCachedTokenDetails(symbol) {
    const now = Date.now();
    const cacheKey = symbol;
    const cachedData = tokenDetailsCache.get(cacheKey);
    
    // 检查缓存是否有效（5分钟内）
    if (cachedData && (now - cachedData.cacheTime < 300000)) {
        return cachedData.data;
    }
    
    // 缓存过期或不存在，重新获取
    const tokenDetails = await getTokenDetails(symbol);
    
    if (tokenDetails) {
        // 更新缓存
        tokenDetailsCache.set(cacheKey, {
            data: tokenDetails,
            cacheTime: now
        });
    }
    
    return tokenDetails;
}

// 基础配置
const CONFIG = {
    interval: '5m',
    historyLimit: 30,
    apiUrl: 'https://fapi.binance.com/fapi/v1/klines',
    wsBaseUrl: 'wss://fstream.binance.com/ws/',
    
    // 并发控制配置
    maxConcurrentConnections: 150, // 增加最大并发连接数
    maxConcurrentAPIRequests: 20,  // API请求并发限制
    connectionRetryDelay: 3000,    // 连接重试延迟
    maxRetryAttempts: 3,           // 最大重试次数
    batchProcessingDelay: 200,     // 批次间处理延迟
    
    // 监控配置
    maxSymbols: 500,
    klineInterval: '1m',
    maxKlineLength: 30,
    
    // 异常检测配置
    volumeThreshold: 2.0,
    consecutiveThreshold: 3,
    timeWindow: 5 * 60 * 1000, // 5分钟
    
    // 清理配置
    cleanupInterval: 10 * 60 * 1000, // 10分钟
    connectionTimeout: 30 * 1000, // 30秒
    maxInactiveTime: 5 * 60 * 1000, // 5分钟
    
    // 默认监控的币种列表 - 您可以在这里修改想要监控的币种
    defaultSymbols: [
    'ALCHUSDT',
    'ALICEUSDT',
    'OPUSDT',
    'KAIAUSDT',
    'BIOUSDT',
    'ACEUSDT',
    'BULLAUSDT',
    'FTMUSDT',
    'FLMUSDT',
    'FILUSDT',
    'FLOWUSDT',
    'FTTUSDT',
    'FETUSDT',
    'FXSUSDT',
    'FILUSDC',
    'FLUXUSDT',
    'FIDAUSDT',
    'FIOUSDT',
    'FARTCOINUSDT',
    'FORMUSDT',
    'FUNUSDT',
    'FORTHUSDT',
    'FHEUSDT',
    'FISUSDT',
    'FUSDT',
    'BADGERUSDT',
    'SCUSDT',
    'SCRUSDT',
    'SCRTUSDT',
    'HBARUSDT',
    'HOTUSDT',
    'HOOKUSDT',
    'HIGHUSDT',
    'HFTUSDT',
    'HIFIUSDT',
    'HMSTRUSDT',
    'HIPPOUSDT',
    'HIVEUSDT',
    'HEIUSDT',
    'HBARUSDC',
    'HYPERUSDT',
    'HAEDALUSDT',
    'HUMAUSDT',
    'HYPEUSDT',
    'HOMEUSDT',
    'HUSDT',
    'ANIMEUSDT',
    'HYPERUSDT',
    'HYPEUSDT',
    'WAVESUSDT',
    'WOOUSDT',
    'WLDUSDT',
    'WAXPUSDT',
    'WIFUSDT',
    'WLDUSDC',
    'WUSDT',
    'WIFUSDC',
    'WALUSDT',
    'WCTUSDT',
    'GMXUSDT',
    'ALPHAUSDT',
    'BTCUSDT',
    'BTCSTUSDT',
    'BTCDOMUSDT',
    'BTCUSDC',
    'BTCUSDT_250926',
    'BTCUSDT_251226',
    'ALPACAUSDT',
    'REIUSDT',
    'DMCUSDT',
    'NEWTUSDT',
    'LITUSDT',
    'PIXELUSDT',
    'BANKUSDT',
    'AINUSDT',
    'MEMEUSDT',
    'METISUSDT',
    'MEWUSDT',
    'MEUSDT',
    'MELANIAUSDT',
    'MEMEFIUSDT',
    'MERLUSDT',
    'ATAUSDT',
    'SOLUSDT',
    'SOLUSDC',
    'SOLVUSDT',
    'FORMUSDT',
    'HYPERUSDT',
    'PNUTUSDT',
    'PNUTUSDC',
    'ALLUSDT',
    'SIRENUSDT',
    'BTCSTUSDT',
    'FLUXUSDT',
    'MILKUSDT',
    'VINEUSDT',
    'TUTUSDT',
    'SXPUSDT',
    'SNXUSDT',
    'SUSHIUSDT',
    'SOLUSDT',
    'STORJUSDT',
    'SKLUSDT',
    'SANDUSDT',
    'SFPUSDT',
    'STMXUSDT',
    'SCUSDT',
    'STGUSDT',
    'SPELLUSDT',
    'STXUSDT',
    'SSVUSDT',
    'SUIUSDT',
    'SEIUSDT',
    'STRAXUSDT',
    'STPTUSDT',
    'SNTUSDT',
    'STEEMUSDT',
    'SUPERUSDT',
    'SOLUSDC',
    'SUIUSDC',
    'STRKUSDT',
    'SAGAUSDT',
    'SYNUSDT',
    'SYSUSDT',
    'SUNUSDT',
    'SCRUSDT',
    'SAFEUSDT',
    'SANTOSUSDT',
    'SWELLUSDT',
    'SLERFUSDT',
    'SCRTUSDT',
    'SPXUSDT',
    'SWARMSUSDT',
    'SONICUSDT',
    'SUSDT',
    'SOLVUSDT',
    'SHELLUSDT',
    'SIRENUSDT',
    'STOUSDT',
    'SIGNUSDT',
    'SXTUSDT',
    'SYRUPUSDT',
    'SKYAIUSDT',
    'SOONUSDT',
    'SOPHUSDT',
    'SKATEUSDT',
    'SQDUSDT',
    'SPKUSDT',
    'SAHARAUSDT',
    'SLPUSDT',
    'ADAUSDT',
    'ADAUSDC',
    'TSTUSDT',
    'AGIXUSDT',
    'ONEUSDT',
    'VIDTUSDT',
    'PROMPTUSDT',
    'GMTUSDT',
    'BMTUSDT',
    'POLYXUSDT',
    'POLUSDT',
    'LINAUSDT',
    'COMBOUSDT',
    'AMBUSDT',
    'TURBOUSDT',
    'TOKENUSDT',
    'NEIROETHUSDT',
    'NEIROUSDT',
    'OMNIUSDT',
    'MEMEUSDT',
    'MEMEFIUSDT',
    'TROYUSDT',
    'SOPHUSDT',
    'JUPUSDT',
    'TONUSDT',
    'STMXUSDT',
    'BNXUSDT',
    'NULSUSDT',
    'IDUSDT',
    'IDEXUSDT',
    'IDOLUSDT',
    'BONDUSDT',
    'UNFIUSDT',
    'BANDUSDT',
    'BANANAUSDT',
    'BANUSDT',
    'BANANAS31USDT',
    'BANKUSDT',
    'MOVEUSDT',
    'PLAYUSDT',
    'DEFIUSDT',
    '1000XECUSDT',
    '1000XUSDT',
    'LEVERUSDT',
    'BDXNUSDT',
    'VELVETUSDT',
    'SWELLUSDT',
    'MAVIAUSDT',
    'RENUSDT',
    'RENDERUSDT',
    'EPTUSDT',
    'BRETTUSDT',
    'BROCCOLI714USDT',
    'BROCCOLIF3BUSDT',
    'BRUSDT',
    'TAOUSDT',
    'TAIKOUSDT',
    'TANSSIUSDT',
    'TACUSDT',
    'TAUSDT',
    'TAGUSDT',
    'IDOLUSDT',
    'KEYUSDT',
    'SKATEUSDT',
    'TANSSIUSDT',
    'HIFIUSDT',
    'LOKAUSDT',
    'ALPINEUSDT',
    'OBOLUSDT',
    'KOMAUSDT',
    'MASKUSDT',
    'VOXELUSDT',
    'MDTUSDT',
    'FLMUSDT',
    'B2USDT',
    'PIPPINUSDT',
    'BLZUSDT',
    'AIOTUSDT',
    'FIOUSDT',
    'FISUSDT',
    'FHEUSDT',
    'COSUSDT',
    'INJUSDT',
    'INITUSDT',
    'INUSDT',
    'ZETAUSDT',
    'CATIUSDT',
    'NAORISUSDT',
    'PORT3USDT',
    'QUICKUSDT',
    'ESPORTSUSDT',
    'ARCUSDT',
    'PERPUSDT',
    'MYROUSDT',
    'SWARMSUSDT',
    'STORJUSDT',
    'STOUSDT',
    'REEFUSDT',
    'THETAUSDT',
    'THEUSDT',
    'BELUSDT',
    'ARPAUSDT',
    'NKNUSDT',
    'GHSTUSDT',
    'DASHUSDT',
    'DOGEUSDT',
    'DOTUSDT',
    'DEFIUSDT',
    'DENTUSDT',
    'DGBUSDT',
    'DYDXUSDT',
    'DUSKUSDT',
    'DARUSDT',
    'DODOXUSDT',
    'DOGEUSDC',
    'DYMUSDT',
    'DOGSUSDT',
    'DIAUSDT',
    'DRIFTUSDT',
    'DEGENUSDT',
    'DEGOUSDT',
    'DEXEUSDT',
    'DFUSDT',
    'DUSDT',
    'DEEPUSDT',
    'DOLOUSDT',
    'DOODUSDT',
    'DMCUSDT',
    'JELLYJELLYUSDT',
    'XEMUSDT',
    'MLNUSDT',
    'LUMIAUSDT',
    'FARTCOINUSDT',
    'OLUSDT',
    'TRXUSDT',
    'THETAUSDT',
    'TRBUSDT',
    'TUSDT',
    'TRUUSDT',
    'TLMUSDT',
    'TIAUSDT',
    'TWTUSDT',
    'TOKENUSDT',
    'TONUSDT',
    'TNSRUSDT',
    'TAOUSDT',
    'TIAUSDC',
    'TURBOUSDT',
    'TROYUSDT',
    'THEUSDT',
    'TRUMPUSDT',
    'TSTUSDT',
    'TRUMPUSDC',
    'TUTUSDT',
    'TAIKOUSDT',
    'TANSSIUSDT',
    'TACUSDT',
    'TAUSDT',
    'TAGUSDT',
    'TREEUSDT',
    'TOWNSUSDT',
    'BAKEUSDT',
    'TACUSDT',
    'DEGOUSDT',
    'OMGUSDT',
    'AVAXUSDT',
    'AVAXUSDC',
    'AVAUSDT',
    'AVAAIUSDT',
    'DYDXUSDT',
    'IDEXUSDT',
    'DOODUSDT',
    'HAEDALUSDT',
    'ZEREBROUSDT',
    'MBOXUSDT',
    'RDNTUSDT',
    'FORTHUSDT',
    'PORTALUSDT',
    'TLMUSDT',
    'DFUSDT',
    'PHBUSDT',
    'HOOKUSDT',
    'RADUSDT',
    'OXTUSDT',
    'DUSKUSDT',
    'GUNUSDT',
    'SYNUSDT',
    'NFPUSDT',
    'VICUSDT',
    'MAVUSDT',
    'MAVIAUSDT',
    'MUBARAKUSDT',
    'EDUUSDT',
    'TREEUSDT',
    'SANTOSUSDT',
    'SYSUSDT',
    'GRIFFAINUSDT',
    'SLERFUSDT',
    'REZUSDT',
    'PUFFERUSDT',
    'STORJUSDT',
    'HEIUSDT',
    'OGNUSDT',
    'A2ZUSDT',
    'COMPUSDT',
    'CRVUSDT',
    'CHZUSDT',
    'COTIUSDT',
    'CHRUSDT',
    'CELRUSDT',
    'C98USDT',
    'CELOUSDT',
    'CTSIUSDT',
    'CFXUSDT',
    'CKBUSDT',
    'COMBOUSDT',
    'CYBERUSDT',
    'CAKEUSDT',
    'CRVUSDC',
    'CHESSUSDT',
    'CATIUSDT',
    'COSUSDT',
    'COWUSDT',
    'CETUSUSDT',
    'CHILLGUYUSDT',
    'CGPTUSDT',
    'COOKIEUSDT',
    'CTKUSDT',
    'CVCUSDT',
    'CROSSUSDT',
    'CUSDT',
    'CVXUSDT',
    'CARVUSDT',
    'ICNTUSDT',
    'OGNUSDT',
    'OGUSDT',
    'CELRUSDT',
    'TNSRUSDT',
    'PARTIUSDT',
    'SHELLUSDT',
    'KERNELUSDT',
    'GPSUSDT',
    'HFTUSDT',
    'HMSTRUSDT',
    'CTKUSDT',
    'LISTAUSDT',
    'MEMEFIUSDT',
    'RAREUSDT',
    'RESOLVUSDT',
    'ZKJUSDT',
    'SOONUSDT',
    'C98USDT',
    'NTRNUSDT',
    'CHILLGUYUSDT',
    'AERGOUSDT',
    'RIFUSDT',
    'SCRTUSDT',
    'HUMAUSDT',
    'WCTUSDT',
    'NILUSDT',
    'OCEANUSDT',
    'SCRUSDT',
    'SCRTUSDT',
    'CTSIUSDT',
    'ASRUSDT',
    'AGLDUSDT',
    'LAYERUSDT',
    'LAUSDT',
    'SOLVUSDT',
    'SKYAIUSDT',
    'JOEUSDT',
    'VANRYUSDT',
    'MOVRUSDT',
    'MTLUSDT',
    'PONKEUSDT',
    'TOWNSUSDT',
    'BANANAS31USDT',
    'SSVUSDT',
    'AUCTIONUSDT',
    'NMRUSDT',
    'STEEMUSDT',
    'RLCUSDT',
    'GLMRUSDT',
    'DOLOUSDT',
    'WAXPUSDT',
    'SAGAUSDT',
    'KNCUSDT',
    'DENTUSDT',
    'ONGUSDT',
    'CVCUSDT',
    'ZRCUSDT',
    'USTCUSDT',
    'MAGICUSDT',
    'CYBERUSDT',
    'USUALUSDT',
    'CHRUSDT',
    'PUNDIXUSDT',
    'CGPTUSDT',
    'TAIKOUSDT',
    'LSKUSDT',
    'BALUSDT',
    'BNTUSDT',
    'COOKIEUSDT',
    'DIAUSDT',
    'CARVUSDT',
    'SIGNUSDT',
    'ARKMUSDT',
    'ARKUSDT',
    'DYMUSDT',
    'SPELLUSDT',
    'PHAUSDT',
    'CETUSUSDT',
    'ORBSUSDT',
    'B3USDT',
    'POWRUSDT',
    'AEVOUSDT',
    'VVVUSDT',
    'API3USDT',
    'FUNUSDT',
    'MANTAUSDT',
    'STRAXUSDT',
    'YALAUSDT',
    'LQTYUSDT',
    'PEOPLEUSDT',
    'YGGUSDT',
    'FIDAUSDT',
    'TAGUSDT',
    'TRBUSDT',
    'HOMEUSDT',
    'IOSTUSDT',
    'ACXUSDT',
    'BICOUSDT',
    'XVSUSDT',
    'MERLUSDT',
    'CROSSUSDT',
    'ACTUSDT',
    'HIVEUSDT',
    'LRCUSDT',
    'ACHUSDT',
    'REDUSDT',
    'SNTUSDT',
    'UMAUSDT',
    'IOTAUSDT',
    'IOSTUSDT',
    'IOTXUSDT',
    'IOUSDT',
    'AWEUSDT',
    'BIGTIMEUSDT',
    'BANDUSDT',
    'SKLUSDT',
    'XVGUSDT',
    'WAVESUSDT',
    'AIXBTUSDT',
    'SXPUSDT',
    'COTIUSDT',
    'SPKUSDT',
    'BOMEUSDT',
    'BOMEUSDC',
    'KMNOUSDT',
    'LAYERUSDT',
    'ENJUSDT',
    'VANAUSDT',
    'KDAUSDT',
    'ZENUSDT',
    'ICXUSDT',
    'AI16ZUSDT',
    'ERAUSDT',
    'WOOUSDT',
    'MELANIAUSDT',
    'STGUSDT',
    'PROMUSDT',
    'PROMPTUSDT',
    'DGBUSDT',
    'ORCAUSDT',
    'SUSHIUSDT',
    'ANKRUSDT',
    'MOODENGUSDT',
    'UXLINKUSDT',
    'POLYXUSDT',
    'RPLUSDT',
    'SAHARAUSDT',
    'HOTUSDT',
    'VTHOUSDT',
    'ETHWUSDT',
    'ILVUSDT',
    'YFIUSDT',
    'CELOUSDT',
    'PROVEUSDT',
    'ASTRUSDT',
    'ORDIUSDT',
    'ORDIUSDC',
    'ZROUSDT',
    'ROSEUSDT',
    'BLURUSDT',
    'MYXUSDT',
    'GASUSDT',
    'ZRXUSDT',
    'SNXUSDT',
    'RVNUSDT',
    'NOTUSDT',
    'GRASSUSDT',
    'ZILUSDT',
    'QTUMUSDT',
    'BATUSDT',
    'ARKMUSDT',
    'MINAUSDT',
    'BERAUSDT',
        // 可以继续添加更多币种...
    ]
};

// 预设的热门币种列表
const POPULAR_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT',
    'XRPUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT',
    'VINEUSDT', 'GOATUSDT', 'SKYAIUSDT', 'SIRENUSDT', 'GRIFFAINUSDT',
    'ZEREBROUSDT', 'DOODUSDT', 'AVAAIUSDT', 'JELLYJELLYUSDT', 'VELVETUSDT',
    'SWARMSIUSDT', 'BULLAUSDT', 'ARCUSDT', 'HIPPOUSDT', 'B2USDT',
    'FUSDT', 'PIPPINUSDT', 'PORT3USDT'
];

// 信号量类 - 用于控制并发数量
class Semaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.currentCount = 0;
        this.waitingQueue = [];
    }

    async acquire() {
        if (this.currentCount < this.maxConcurrent) {
            this.currentCount++;
            return Promise.resolve(() => this.release());
        }
        
        return new Promise((resolve) => {
            this.waitingQueue.push(resolve);
        }).then(() => {
            this.currentCount++;
            return () => this.release();
        });
    }

    release() {
        this.currentCount--;
        if (this.waitingQueue.length > 0) {
            const next = this.waitingQueue.shift();
            next();
        }
    }
}

// 连接重试管理器
class ConnectionRetryManager {
    constructor(maxRetries = CONFIG.maxRetryAttempts, baseDelay = CONFIG.connectionRetryDelay) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
        this.retryCounts = new Map(); // symbol -> retry count
        this.lastRetryTime = new Map(); // symbol -> last retry timestamp
        this.retryCooldown = 30000; // 30秒冷却期，避免频繁重连
        this.connectionStates = new Map(); // symbol -> connection state
    }

    shouldRetry(symbol) {
        const retryCount = this.retryCounts.get(symbol) || 0;
        return retryCount < this.maxRetries;
    }

    canRetry(symbol) {
        const lastTime = this.lastRetryTime.get(symbol) || 0;
        const retryCount = this.retryCounts.get(symbol) || 0;
        
        // 检查是否在冷却期内
        if (Date.now() - lastTime < this.retryCooldown) {
            return false;
        }
        
        // 检查重试次数
        return retryCount < this.maxRetries;
    }

    incrementRetryCount(symbol) {
        const currentCount = this.retryCounts.get(symbol) || 0;
        const newCount = currentCount + 1;
        this.retryCounts.set(symbol, newCount);
        this.lastRetryTime.set(symbol, Date.now());
        
        // 更新连接状态
        this.connectionStates.set(symbol, {
            status: 'retrying',
            retryCount: newCount,
            lastRetryTime: Date.now(),
            nextRetryTime: Date.now() + this.getRetryDelay(symbol)
        });
        
        return newCount;
    }

    getRetryDelay(symbol) {
        const retryCount = this.retryCounts.get(symbol) || 0;
        // 指数退避策略，但设置最大延迟
        const delay = Math.min(this.baseDelay * Math.pow(2, retryCount), 60000);
        return delay;
    }

    resetRetryCount(symbol) {
        this.retryCounts.delete(symbol);
        this.lastRetryTime.delete(symbol);
        this.connectionStates.set(symbol, {
            status: 'connected',
            retryCount: 0,
            lastRetryTime: null,
            nextRetryTime: null
        });
    }

    getConnectionState(symbol) {
        return this.connectionStates.get(symbol) || {
            status: 'unknown',
            retryCount: 0,
            lastRetryTime: null,
            nextRetryTime: null
        };
    }

    // 清理过期的重试记录
    cleanup() {
        const now = Date.now();
        const cleanupThreshold = 30 * 60 * 1000; // 30分钟
        
        for (const [symbol, lastTime] of this.lastRetryTime.entries()) {
            if (now - lastTime > cleanupThreshold) {
                this.retryCounts.delete(symbol);
                this.lastRetryTime.delete(symbol);
                this.connectionStates.delete(symbol);
            }
        }
    }
}

// 全局重试管理器实例
const retryManager = new ConnectionRetryManager();

class MultiSymbolKlineManager {
    constructor() {
        this.symbols = new Map(); // symbol -> KlineManager
        this.connections = new Map(); // symbol -> WebSocket
        this.connectionPool = new Map(); // 连接池管理
        this.maxConnections = CONFIG.maxConcurrentConnections; // 使用配置的最大并发连接数
        this.connectionQueue = []; // 连接队列
        this.isProcessingQueue = false;
        this.connectionSemaphore = 0; // 连接信号量控制
        this.apiRequestSemaphore = 0; // API请求信号量控制
        this.retryAttempts = new Map(); // 记录重试次数
        this.connectionHealth = new Map(); // 连接健康状态
        this.stats = {
            totalSymbols: 0,
            activeConnections: 0,
            queuedConnections: 0,
            memoryUsage: 0,
            failedConnections: 0,
            retryCount: 0,
            successfulConnections: 0,
            dataReceivedCount: 0,
            lastDataTime: null,
            connectionErrors: 0,
            reconnectionAttempts: 0
        };
        
        // 启动定期清理任务
        this.startCleanupTasks();
    }

    // 更新连接统计信息
    updateConnectionStats() {
        this.stats.activeConnections = this.connections.size;
        this.stats.queuedConnections = this.connectionQueue.length;
        this.stats.totalSymbols = this.symbols.size;
    }

    // 启动定期清理任务
    startCleanupTasks() {
        // 每5分钟清理一次不活跃连接
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 5 * 60 * 1000);
        
        // 每10分钟优化一次内存
        setInterval(() => {
            this.optimizeMemory();
        }, 10 * 60 * 1000);
        
        // 每30秒处理连接队列
        setInterval(() => {
            if (this.connectionQueue.length > 0 && !this.isProcessingQueue) {
                this.processConnectionQueue();
            }
        }, 30000);
        
        // 每2分钟检查连接健康状态
        setInterval(() => {
            this.checkConnectionHealth();
        }, 2 * 60 * 1000);
        
        // 每5分钟清理重试管理器
        setInterval(() => {
            retryManager.cleanup();
        }, 5 * 60 * 1000);
    }

    // 添加新的监控币种（支持批量添加）
    addSymbol(symbol) {
        if (!this.symbols.has(symbol)) {
            this.symbols.set(symbol, new KlineManager(CONFIG.historyLimit, symbol));
            this.updateConnectionStats();
            console.log(`✅ 添加监控币种: ${symbol} (总数: ${this.stats.totalSymbols})`);
            
            // 检查连接池容量
            if (this.stats.activeConnections < this.maxConnections) {
                this.connectSymbol(symbol);
            } else {
                this.queueConnection(symbol);
            }
            return true;
        }
        console.log(`⚠️ ${symbol} 已在监控列表中`);
        return false;
    }

    // 批量添加币种（优化版本 - 并行处理）
    async addSymbols(symbols) {
        console.log(`🔄 批量添加 ${symbols.length} 个币种...`);
        let addedCount = 0;
        
        // 第一步：快速添加所有币种到管理器
        const symbolsToAdd = [];
        for (const symbol of symbols) {
            if (!this.symbols.has(symbol)) {
                this.symbols.set(symbol, new KlineManager(CONFIG.historyLimit, symbol));
                symbolsToAdd.push(symbol);
                addedCount++;
            }
        }
        
        this.stats.totalSymbols = this.symbols.size;
        console.log(`✅ 已添加 ${addedCount} 个币种到管理器`);
        
        if (symbolsToAdd.length === 0) {
            console.log('⚠️ 所有币种都已存在，无需添加');
            return 0;
        }
        
        // 第二步：并行获取历史数据（使用信号量控制并发）
        console.log(`📊 开始并行获取历史数据...`);
        const batchSize = CONFIG.maxConcurrentAPIRequests; // 使用配置的API请求并发限制
        const batches = [];
        
        for (let i = 0; i < symbolsToAdd.length; i += batchSize) {
            batches.push(symbolsToAdd.slice(i, i + batchSize));
        }
        
        let processedCount = 0;
        let failedCount = 0;
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`🔄 处理第 ${batchIndex + 1}/${batches.length} 批 (${batch.length} 个币种)...`);
            
            // 使用信号量控制并发
            const semaphore = new Semaphore(CONFIG.maxConcurrentAPIRequests);
            const promises = batch.map(async (symbol) => {
                return semaphore.acquire().then(async (release) => {
                    try {
                        const success = await this.fetchHistoricalKlinesWithRetry(symbol);
                        release();
                        if (success) {
                            return { symbol, success: true };
                        } else {
                            return { symbol, success: false, error: '历史数据获取失败' };
                        }
                    } catch (error) {
                        release();
                        return { symbol, success: false, error: error.message };
                    }
                });
            });
            
            // 等待当前批次完成
            const results = await Promise.allSettled(promises);
            const successfulSymbols = [];
            
            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value.success) {
                    successfulSymbols.push(result.value.symbol);
                    processedCount++;
                } else {
                    const symbol = result.status === 'fulfilled' ? result.value.symbol : 'unknown';
                    console.log(`❌ ${symbol} 历史数据获取失败`);
                    failedCount++;
                }
            });
            
            // 第三步：并行建立WebSocket连接
            if (successfulSymbols.length > 0) {
                console.log(`🔗 为 ${successfulSymbols.length} 个币种建立WebSocket连接...`);
                
                // 使用连接信号量控制并发连接数
                const connectionSemaphore = new Semaphore(this.maxConnections);
                const connectionPromises = successfulSymbols.map(async (symbol) => {
                    return connectionSemaphore.acquire().then(async (release) => {
                        try {
                            const success = await this.connectSymbolWithRetry(symbol);
                            release();
                            return { symbol, success };
                        } catch (error) {
                            release();
                            return { symbol, success: false, error: error.message };
                        }
                    });
                });
                
                const connectionResults = await Promise.allSettled(connectionPromises);
                let connectedCount = 0;
                
                connectionResults.forEach((result) => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        connectedCount++;
                    }
                });
                
                console.log(`✅ 第 ${batchIndex + 1} 批完成: ${connectedCount}/${successfulSymbols.length} 个已连接`);
            }
            
            // 批次间延迟，避免API限制
            if (batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.batchProcessingDelay));
            }
        }
        
        console.log(`🎉 批量添加完成！成功处理 ${processedCount}/${addedCount} 个币种，失败 ${failedCount} 个`);
        
        // 更新统计信息
        this.updateConnectionStats();
        
        // 处理连接队列
        if (this.connectionQueue.length > 0) {
            console.log(`⏳ 开始处理连接队列中的 ${this.connectionQueue.length} 个币种...`);
            this.processConnectionQueue();
        }
        
        return processedCount;
    }

    // 连接单个币种
    async connectSymbol(symbol) {
        if (this.stats.activeConnections >= this.maxConnections) {
            this.queueConnection(symbol);
            return false;
        }

        try {
            await this.fetchHistoricalKlinesWithRetry(symbol);
            const success = await this.connectWebSocketWithRetry(symbol);
            if (success) {
                this.updateConnectionStats();
                retryManager.resetRetryCount(symbol);
                // 更新连接健康状态
                this.connectionHealth.set(symbol, {
                    status: 'connected',
                    lastUpdate: Date.now(),
                    errorCount: 0
                });
            }
            return success;
        } catch (error) {
            console.error(`❌ ${symbol} 连接失败:`, error.message);
            this.stats.failedConnections++;
            this.stats.connectionErrors++;
            this.updateConnectionStats();
            return false;
        }
    }

    // 带重试的历史数据获取
    async fetchHistoricalKlinesWithRetry(symbol) {
        let attempts = 0;
        const maxAttempts = CONFIG.maxRetryAttempts;
        
        while (attempts < maxAttempts) {
            try {
                const success = await fetchHistoricalKlines(symbol);
                if (success) {
                    return true;
                }
                attempts++;
            } catch (error) {
                attempts++;
                console.warn(`⚠️ ${symbol} 历史数据获取失败 (尝试 ${attempts}/${maxAttempts}):`, error.message);
                
                if (attempts < maxAttempts) {
                    const delay = retryManager.getRetryDelay(symbol);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        console.error(`❌ ${symbol} 历史数据获取最终失败，已尝试 ${maxAttempts} 次`);
        return false;
    }

    // 带重试的WebSocket连接
    async connectWebSocketWithRetry(symbol) {
        let attempts = 0;
        const maxAttempts = CONFIG.maxRetryAttempts;
        
        while (attempts < maxAttempts) {
            try {
                const ws = await this.createWebSocketConnection(symbol);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    this.setConnection(symbol, ws);
                    return true;
                }
                attempts++;
            } catch (error) {
                attempts++;
                console.warn(`⚠️ ${symbol} WebSocket连接失败 (尝试 ${attempts}/${maxAttempts}):`, error.message);
                
                if (attempts < maxAttempts) {
                    const delay = retryManager.getRetryDelay(symbol);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        console.error(`❌ ${symbol} WebSocket连接最终失败，已尝试 ${maxAttempts} 次`);
        return false;
    }

    // 创建WebSocket连接
    createWebSocketConnection(symbol) {
        return new Promise((resolve, reject) => {
            const wsUrl = `${CONFIG.wsBaseUrl}${symbol.toLowerCase()}@kline_${CONFIG.interval}`;
            
            const ws = new WebSocket(wsUrl, {
                agent: agent,
                handshakeTimeout: 15000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Multi-Symbol Volume Monitor)'
                }
            });

            const timeout = setTimeout(() => {
                ws.terminate();
                reject(new Error('连接超时'));
            }, 15000);

            ws.on('open', () => {
                clearTimeout(timeout);
                console.log(`🔗 ${symbol} WebSocket连接成功`);
                this.setupWebSocketHandlers(ws, symbol);
                this.setConnection(symbol, ws); // 更新连接状态
                
                // 更新连接统计
                if (this.stats) {
                    this.stats.successfulConnections = (this.stats.successfulConnections || 0) + 1;
                }
                
                // 更新连接健康状态
                this.connectionHealth.set(symbol, {
                    status: 'connected',
                    lastUpdate: Date.now(),
                    errorCount: 0
                });
                
                resolve(ws);
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    // 设置WebSocket事件处理器
    setupWebSocketHandlers(ws, symbol) {
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                const klineData = message.k;

                if (klineData) {
                    // 构建K线对象
                    const currentKline = {
                        openTime: parseInt(klineData.t),
                        closeTime: parseInt(klineData.T),
                        open: parseFloat(klineData.o),
                        high: parseFloat(klineData.h),
                        low: parseFloat(klineData.l),
                        close: parseFloat(klineData.c),
                        volume: parseFloat(klineData.v),
                        quoteVolume: parseFloat(klineData.q),
                        trades: parseInt(klineData.n),
                        isCompleted: klineData.x, // K线是否已完成
                        buyVolume: parseFloat(klineData.V || 0), // 主动买入的成交量
                        buyQuoteVolume: parseFloat(klineData.Q || 0) // 主动买入的成交额
                    };

                    // 更新K线管理器（包括进行中的K线）
                    const klineManager = this.getKlineManager(symbol);
                    if (klineManager && klineManager.isInitialized) {
                        klineManager.addKline(currentKline);
                        
                        // 如果K线已完成，进行详细分析
                        if (klineData.x) {
                            handleCompletedKline(symbol, currentKline);
                        }
                        // 如果是进行中的K线，进行实时监控
                        else {
                            handleOngoingKline(symbol, currentKline);
                        }
                        
                        // 更新最后活动时间
                        klineManager.lastUpdateTime = Date.now();
                        
                        // 更新数据接收统计
                        if (this.stats) {
                            this.stats.dataReceivedCount = (this.stats.dataReceivedCount || 0) + 1;
                            this.stats.lastDataTime = Date.now();
                        }
                        
                        // 每100条数据输出一次接收状态
                        if (this.stats && this.stats.dataReceivedCount && this.stats.dataReceivedCount % 100 === 0) {
                            console.log(`📡 数据接收状态: 已接收 ${this.stats.dataReceivedCount} 条K线数据`);
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ ${symbol} 消息处理失败:`, error.message);
            }
        });

        ws.on('error', (error) => {
            console.error(`❌ ${symbol} WebSocket错误:`, error.message);
            this.handleWebSocketError(symbol, error);
        });

        ws.on('close', () => {
            console.log(`⚠️ ${symbol} WebSocket连接断开`);
            this.handleWebSocketClose(symbol);
        });
    }

    // 处理WebSocket错误
    handleWebSocketError(symbol, error) {
        // 从连接映射中移除
        if (this.connections.has(symbol)) {
            this.connections.delete(symbol);
            this.updateConnectionStats();
        }
        
        // 更新失败连接统计
        if (this.stats) {
            this.stats.failedConnections = (this.stats.failedConnections || 0) + 1;
            this.stats.connectionErrors = (this.stats.connectionErrors || 0) + 1;
        }
        
        // 更新连接健康状态
        const currentHealth = this.connectionHealth.get(symbol) || { errorCount: 0 };
        this.connectionHealth.set(symbol, {
            status: 'error',
            lastUpdate: Date.now(),
            errorCount: currentHealth.errorCount + 1,
            lastError: error.message
        });
        
        if (retryManager.canRetry(symbol)) {
            const retryCount = retryManager.incrementRetryCount(symbol);
            const delay = retryManager.getRetryDelay(symbol);
            
            console.log(`🔄 ${symbol} 将在 ${delay}ms 后尝试重连 (第 ${retryCount} 次重试)...`);
            this.stats.reconnectionAttempts++;
            
            setTimeout(async () => {
                if (this.symbols.has(symbol)) {
                    await this.reconnectSymbol(symbol);
                }
            }, delay);
        } else {
            console.error(`❌ ${symbol} 重连次数已达上限或仍在冷却期内，移除监控`);
            this.removeSymbol(symbol);
        }
    }

    // 处理WebSocket关闭
    handleWebSocketClose(symbol) {
        // 从连接映射中移除
        if (this.connections.has(symbol)) {
            this.connections.delete(symbol);
            this.updateConnectionStats();
        }
        
        // 更新失败连接统计
        if (this.stats) {
            this.stats.failedConnections = (this.stats.failedConnections || 0) + 1;
        }
        
        // 更新连接健康状态
        const currentHealth = this.connectionHealth.get(symbol) || { errorCount: 0 };
        this.connectionHealth.set(symbol, {
            status: 'disconnected',
            lastUpdate: Date.now(),
            errorCount: currentHealth.errorCount,
            lastError: 'Connection closed'
        });
        
        if (retryManager.canRetry(symbol)) {
            const retryCount = retryManager.incrementRetryCount(symbol);
            const delay = retryManager.getRetryDelay(symbol);
            
            console.log(`🔄 ${symbol} 将在 ${delay}ms 后尝试重连 (第 ${retryCount} 次重试)...`);
            this.stats.reconnectionAttempts++;
            
            setTimeout(async () => {
                if (this.symbols.has(symbol)) {
                    await this.reconnectSymbol(symbol);
                }
            }, delay);
        } else {
            console.error(`❌ ${symbol} 重连次数已达上限或仍在冷却期内，移除监控`);
            this.removeSymbol(symbol);
        }
    }

    // 重连币种
    async reconnectSymbol(symbol) {
        try {
            console.log(`🔄 尝试重连 ${symbol}...`);
            
            // 更新连接健康状态
            this.connectionHealth.set(symbol, {
                status: 'reconnecting',
                lastUpdate: Date.now(),
                errorCount: 0
            });
            
            const success = await this.connectWebSocketWithRetry(symbol);
            if (success) {
                console.log(`✅ ${symbol} 重连成功`);
                this.connectionHealth.set(symbol, {
                    status: 'connected',
                    lastUpdate: Date.now(),
                    errorCount: 0
                });
            } else {
                console.error(`❌ ${symbol} 重连失败`);
                this.connectionHealth.set(symbol, {
                    status: 'failed',
                    lastUpdate: Date.now(),
                    errorCount: (this.connectionHealth.get(symbol)?.errorCount || 0) + 1
                });
            }
            return success;
        } catch (error) {
            console.error(`❌ ${symbol} 重连异常:`, error.message);
            this.connectionHealth.set(symbol, {
                status: 'error',
                lastUpdate: Date.now(),
                errorCount: (this.connectionHealth.get(symbol)?.errorCount || 0) + 1,
                lastError: error.message
            });
            return false;
        }
    }

    // 将连接加入队列
    queueConnection(symbol) {
        if (!this.connectionQueue.includes(symbol)) {
            this.connectionQueue.push(symbol);
            this.stats.queuedConnections = this.connectionQueue.length;
            console.log(`⏳ ${symbol} 加入连接队列 (队列长度: ${this.stats.queuedConnections})`);
        }
    }

    // 处理连接队列
    async processConnectionQueue() {
        if (this.isProcessingQueue || this.connectionQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        console.log(`🔄 开始处理连接队列，共 ${this.connectionQueue.length} 个待连接币种...`);

        // 使用信号量控制并发连接数
        const connectionSemaphore = new Semaphore(this.maxConnections);
        const queueItems = [...this.connectionQueue]; // 复制队列，避免并发修改
        this.connectionQueue = []; // 清空原队列
        
        // 并行处理队列中的连接，但控制并发数
        const connectionPromises = queueItems.map(async (symbol) => {
            return connectionSemaphore.acquire().then(async (release) => {
                try {
                    const success = await this.connectSymbolWithRetry(symbol);
                    release();
                    return { symbol, success };
                } catch (error) {
                    release();
                    return { symbol, success: false, error: error.message };
                }
            });
        });

        // 等待所有连接完成
        const results = await Promise.allSettled(connectionPromises);
        let successCount = 0;
        let failCount = 0;

        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                const { symbol, success } = result.value;
                if (success) {
                    successCount++;
                } else {
                    failCount++;
                    // 如果连接失败，重新加入队列（但限制重试次数）
                    if (retryManager.shouldRetry(symbol)) {
                        this.queueConnection(symbol);
                    } else {
                        console.error(`❌ ${symbol} 连接失败次数过多，从监控中移除`);
                        this.removeSymbol(symbol);
                    }
                }
            } else {
                failCount++;
                console.error(`❌ 连接处理异常:`, result.reason);
            }
        });

        this.stats.queuedConnections = this.connectionQueue.length;
        this.isProcessingQueue = false;
        
        console.log(`✅ 连接队列处理完成: ${successCount} 个成功, ${failCount} 个失败`);
        
        if (this.connectionQueue.length > 0) {
            console.log(`⏳ 连接队列中还有 ${this.connectionQueue.length} 个币种等待连接`);
        } else {
            console.log(`✅ 所有币种连接完成`);
        }
    }

    // 移除监控币种
    removeSymbol(symbol) {
        if (this.symbols.has(symbol)) {
            // 关闭WebSocket连接
            if (this.connections.has(symbol)) {
                this.connections.get(symbol).terminate();
                this.connections.delete(symbol);
                // 更新活跃连接统计
                this.stats.activeConnections = this.connections.size;
            }
            
            // 从队列中移除
            const queueIndex = this.connectionQueue.indexOf(symbol);
            if (queueIndex > -1) {
                this.connectionQueue.splice(queueIndex, 1);
                this.stats.queuedConnections = this.connectionQueue.length;
            }
            
            this.symbols.delete(symbol);
            this.stats.totalSymbols = this.symbols.size;
            console.log(`❌ 移除监控币种: ${symbol} (剩余: ${this.stats.totalSymbols})`);
            
            // 处理队列中的连接
            this.processConnectionQueue();
            return true;
        }
        return false;
    }

    // 批量移除币种
    removeSymbols(symbols) {
        console.log(`🔄 批量移除 ${symbols.length} 个币种...`);
        let removedCount = 0;
        
        for (const symbol of symbols) {
            if (this.removeSymbol(symbol)) {
                removedCount++;
            }
        }
        
        console.log(`✅ 批量移除完成，成功移除 ${removedCount} 个币种`);
        return removedCount;
    }

    // 获取所有监控的币种
    getSymbols() {
        return Array.from(this.symbols.keys());
    }

    // 获取指定币种的管理器
    getKlineManager(symbol) {
        return this.symbols.get(symbol);
    }

    // 设置WebSocket连接
    setConnection(symbol, ws) {
        this.connections.set(symbol, ws);
        // 更新活跃连接统计
        this.stats.activeConnections = this.connections.size;
    }

    // 获取WebSocket连接
    getConnection(symbol) {
        return this.connections.get(symbol);
    }

    // 获取统计信息
    getStats() {
        const memoryUsage = process.memoryUsage();
        this.stats.memoryUsage = Math.round(memoryUsage.heapUsed / 1024 / 1024); // MB
        
        // 实时计算活跃连接数，确保准确性
        this.stats.activeConnections = this.connections.size;
        
        // 计算连接成功率
        const totalAttempts = this.stats.activeConnections + this.stats.failedConnections;
        const connectionSuccessRate = totalAttempts > 0 ? 
            ((this.stats.activeConnections / totalAttempts) * 100).toFixed(1) : 0;
        
        // 计算队列处理效率
        const queueEfficiency = this.stats.queuedConnections > 0 ? 
            ((this.stats.activeConnections / (this.stats.activeConnections + this.stats.queuedConnections)) * 100).toFixed(1) : 100;
        
        return {
            ...this.stats,
            memoryUsageMB: this.stats.memoryUsage,
            connectionUtilization: `${this.stats.activeConnections}/${this.maxConnections}`,
            connectionSuccessRate: `${connectionSuccessRate}%`,
            queueEfficiency: `${queueEfficiency}%`,
            queueLength: this.stats.queuedConnections,
            retryCount: this.stats.retryCount,
            failedConnections: this.stats.failedConnections,
            // 系统资源使用情况
            systemMemory: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                external: Math.round(memoryUsage.external / 1024 / 1024),
                rss: Math.round(memoryUsage.rss / 1024 / 1024)
            }
        };
    }

    // 清理不活跃的连接
    cleanupInactiveConnections() {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5分钟无活动
        let cleanedCount = 0;
        
        // 保存当前监控的币种列表，避免完全清理
        const currentSymbols = Array.from(this.symbols.keys());
        
        for (const [symbol, klineManager] of this.symbols.entries()) {
            if (now - klineManager.lastUpdateTime > inactiveThreshold) {
                console.log(`🧹 清理不活跃连接: ${symbol}`);
                // 只清理WebSocket连接，保留币种监控
                if (this.connections.has(symbol)) {
                    const ws = this.connections.get(symbol);
                    if (ws) {
                        ws.close();
                        this.connections.delete(symbol);
                    }
                    cleanedCount++;
                }
                // 重置最后更新时间，给币种一个重新开始的机会
                klineManager.lastUpdateTime = now;
            }
        }
        
        if (cleanedCount > 0) {
            // 更新活跃连接统计
            this.stats.activeConnections = this.connections.size;
            console.log(`🧹 清理完成，共清理 ${cleanedCount} 个不活跃连接`);
            // 清理后立即尝试重新连接
            this.reconnectCleanedSymbols();
        }
        
        // 清理过期的重试记录
        const retryCleanupThreshold = 30 * 60 * 1000; // 30分钟
        for (const [symbol, retryInfo] of retryManager.retryCounts.entries()) {
            if (!this.symbols.has(symbol)) {
                retryManager.retryCounts.delete(symbol);
            }
        }
    }

    // 重新连接被清理的币种
    async reconnectCleanedSymbols() {
        const symbolsToReconnect = Array.from(this.symbols.keys()).filter(symbol => 
            !this.connections.has(symbol) || 
            !this.connections.get(symbol) || 
            this.connections.get(symbol).readyState !== WebSocket.OPEN
        );
        
        if (symbolsToReconnect.length > 0) {
            console.log(`🔄 尝试重新连接 ${symbolsToReconnect.length} 个币种...`);
            
            // 分批重新连接，避免同时建立过多连接
            const batchSize = 10;
            for (let i = 0; i < symbolsToReconnect.length; i += batchSize) {
                const batch = symbolsToReconnect.slice(i, i + batchSize);
                const promises = batch.map(symbol => this.connectSymbol(symbol));
                
                try {
                    await Promise.allSettled(promises);
                    console.log(`✅ 批次 ${Math.floor(i/batchSize) + 1} 重新连接完成`);
                } catch (error) {
                    console.error(`❌ 批次 ${Math.floor(i/batchSize) + 1} 重新连接失败:`, error.message);
                }
                
                // 批次间延迟
                if (i + batchSize < symbolsToReconnect.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }

    // 优化内存使用
    optimizeMemory() {
        let optimizedCount = 0;
        
        // 清理过期的历史数据
        for (const klineManager of this.symbols.values()) {
            if (klineManager.klines.length > CONFIG.historyLimit) {
                const removedCount = klineManager.klines.length - CONFIG.historyLimit;
                klineManager.klines = klineManager.klines.slice(-CONFIG.historyLimit);
                optimizedCount += removedCount;
            }
            
            // 清理过期的成交量历史
            if (klineManager.volumeHistory.length > 20) {
                klineManager.volumeHistory = klineManager.volumeHistory.slice(-20);
            }
            
            // 清理过期的警报历史
            if (klineManager.alertHistory.length > 10) {
                klineManager.alertHistory = klineManager.alertHistory.slice(-10);
            }
        }
        
        // 清理过期的消息去重缓存
        const now = Date.now();
        for (const [hash, timestamp] of messageDeduplicationCache.entries()) {
            if (now - timestamp > DEDUPLICATION_WINDOW) {
                messageDeduplicationCache.delete(hash);
            }
        }
        
        // 强制垃圾回收
        if (global.gc) {
            global.gc();
        }
        
        if (optimizedCount > 0) {
            console.log(`🧹 内存优化完成，清理了 ${optimizedCount} 条过期数据`);
        }
    }

    // 连接健康检查
    async checkConnectionHealth() {
        const healthReport = {
            totalSymbols: this.symbols.size,
            activeConnections: 0,
            brokenConnections: 0,
            queuedConnections: this.connectionQueue.length,
            memoryUsage: this.getStats().memoryUsageMB,
            timestamp: new Date().toISOString()
        };

        for (const [symbol, ws] of this.connections.entries()) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                healthReport.activeConnections++;
            } else {
                healthReport.brokenConnections++;
                // 标记为需要重连
                if (this.symbols.has(symbol)) {
                    console.log(`⚠️ 检测到断开的连接: ${symbol}`);
                    this.queueConnection(symbol);
                }
            }
        }

        // 更新统计信息
        this.stats.activeConnections = healthReport.activeConnections;
        
        return healthReport;
    }

    // 获取连接状态摘要
    getConnectionStatus() {
        const stats = this.getStats();
        const health = this.checkConnectionHealth();
        
        return {
            summary: {
                totalSymbols: stats.totalSymbols,
                activeConnections: stats.activeConnections,
                queuedConnections: stats.queuedConnections,
                connectionUtilization: stats.connectionUtilization,
                connectionSuccessRate: stats.connectionSuccessRate,
                queueEfficiency: stats.queueEfficiency
            },
            memory: stats.systemMemory,
            performance: {
                failedConnections: stats.failedConnections,
                retryCount: stats.retryCount,
                memoryUsageMB: stats.memoryUsageMB
            },
            timestamp: new Date().toISOString()
        };
    }
}

// 单个币种的K线管理器
class KlineManager {
    constructor(maxLength = 30, symbol = '') {
        this.symbol = symbol;
        this.klines = [];
        this.maxLength = maxLength;
        this.isInitialized = false;
        this.lastUpdateTime = 0;
        
        // 新增：趋势分析相关属性
        this.volumeHistory = []; // 记录最近10根K线的成交量变化
        this.alertHistory = []; // 记录最近5次警报情况
        this.consecutiveAbnormalCount = 0; // 连续异常次数
        this.lastAbnormalType = null; // 上次异常类型
        this.trendStrength = 0; // 趋势强度 (0-100)
    }

    // 添加新的K线数据并维护滑动窗口
    addKline(klineData) {
        // 检查是否是重复数据
        if (this.klines.length > 0) {
            const lastKline = this.klines[this.klines.length - 1];
            if (lastKline.openTime === klineData.openTime) {
                // 更新最后一根K线数据（实时更新）
                this.klines[this.klines.length - 1] = klineData;
                // 更新买入量历史（实时更新）
                if (klineData.buyVolume !== undefined) {
                    this.updateVolumeHistory(klineData.buyVolume);
                }
                return;
            }
        }

        // 添加新的K线
        this.klines.push(klineData);
        
        // 维护滑动窗口：保持最新的30根K线
        while (this.klines.length > this.maxLength) {
            this.klines.shift(); // 移除最旧的K线
        }

        // 更新买入量历史
        if (klineData.buyVolume !== undefined) {
            this.updateVolumeHistory(klineData.buyVolume);
        }

        this.lastUpdateTime = Date.now();
    }

    // 新增：更新成交量历史记录
    updateVolumeHistory(currentBuyVolume) {
        this.volumeHistory.push({
            volume: currentBuyVolume,
            timestamp: Date.now()
        });
        
        // 只保留最近10根K线的记录
        if (this.volumeHistory.length > 10) {
            this.volumeHistory.shift();
        }
    }

    // 重新设计：分析买入量趋势 - 智能版本
    analyzeVolumeTrend() {
        if (this.volumeHistory.length < 3) {
            return { 
                trend: 'insufficient', 
                strength: 0,
                reason: `数据不足 (${this.volumeHistory.length}/3) - 需要至少3根K线数据`,
                details: {
                    volumeHistoryLength: this.volumeHistory.length,
                    requiredLength: 3,
                    recentVolumes: this.volumeHistory.map(v => v.volume)
                }
            };
        }

        // 获取最近10根K线的买入量数据
        const recentVolumes = this.volumeHistory.slice(-10).map(v => v.volume);
        
        // 1. 短期买入量趋势分析 (最近3根K线)
        const shortTermVolumes = recentVolumes.slice(-3);
        const shortTermTrend = this.calculateTrendDirection(shortTermVolumes, '短期');
        
        // 2. 中期买入量趋势分析 (最近5根K线)
        const mediumTermVolumes = recentVolumes.slice(-5);
        const mediumTermTrend = this.calculateTrendDirection(mediumTermVolumes, '中期');
        
        // 3. 长期买入量趋势分析 (最近10根K线)
        const longTermTrend = this.calculateTrendDirection(recentVolumes, '长期');
        
        // 4. 综合买入量趋势判断
        const comprehensiveTrend = this.combineTrendAnalysis(shortTermTrend, mediumTermTrend, longTermTrend);
        
        return comprehensiveTrend;
    }

    // 计算买入量趋势方向
    calculateTrendDirection(volumes, period) {
        if (volumes.length < 2) {
            return { trend: 'insufficient', strength: 0, reason: '数据不足' };
        }

        let increasingCount = 0;
        let decreasingCount = 0;
        let totalChange = 0;
        let consecutiveIncreases = 0;
        let consecutiveDecreases = 0;
        let maxConsecutiveIncreases = 0;
        let maxConsecutiveDecreases = 0;

        for (let i = 1; i < volumes.length; i++) {
            const change = volumes[i] - volumes[i-1];
            totalChange += change;
            
            if (change > 0) {
                increasingCount++;
                consecutiveIncreases++;
                consecutiveDecreases = 0;
                maxConsecutiveIncreases = Math.max(maxConsecutiveIncreases, consecutiveIncreases);
            } else if (change < 0) {
                decreasingCount++;
                consecutiveDecreases++;
                consecutiveIncreases = 0;
                maxConsecutiveDecreases = Math.max(maxConsecutiveDecreases, consecutiveDecreases);
            } else {
                consecutiveIncreases = 0;
                consecutiveDecreases = 0;
            }
        }

        // 计算平均变化率
        const avgChange = totalChange / (volumes.length - 1);
        const avgBuyVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const changeRate = avgBuyVolume > 0 ? Math.abs(avgChange) / avgBuyVolume * 100 : 0;

        // 计算买入量趋势一致性
        const trendConsistency = Math.max(increasingCount, decreasingCount) / (volumes.length - 1) * 100;
        
        // 计算连续买入量趋势强度
        const consecutiveStrength = Math.max(maxConsecutiveIncreases, maxConsecutiveDecreases) / (volumes.length - 1) * 100;
        
        // 综合买入量强度计算
        const combinedStrength = Math.min(
            trendConsistency * 0.4 + 
            consecutiveStrength * 0.3 + 
            changeRate * 0.3, 
            100
        );

        let trend = 'stable';
        let reason = '趋势稳定';
        
        if (increasingCount > decreasingCount && combinedStrength > 30) {
            trend = 'increasing';
            reason = `${period}上升趋势 (${increasingCount}/${volumes.length-1}次增长, 连续${maxConsecutiveIncreases}次, 强度:${combinedStrength.toFixed(1)}%)`;
        } else if (decreasingCount > increasingCount && combinedStrength > 30) {
            trend = 'decreasing';
            reason = `${period}下降趋势 (${decreasingCount}/${volumes.length-1}次下降, 连续${maxConsecutiveDecreases}次, 强度:${combinedStrength.toFixed(1)}%)`;
        } else if (combinedStrength > 20) {
            trend = 'volatile';
            reason = `${period}波动趋势 (强度:${combinedStrength.toFixed(1)}%, 变化率:${changeRate.toFixed(2)}%)`;
        } else {
            reason = `${period}稳定趋势 (强度:${combinedStrength.toFixed(1)}%, 变化率:${changeRate.toFixed(2)}%)`;
        }

        return {
            trend,
            strength: combinedStrength,
            reason,
            period,
            details: {
                increasingCount,
                decreasingCount,
                maxConsecutiveIncreases,
                maxConsecutiveDecreases,
                avgChange,
                changeRate: changeRate.toFixed(2),
                trendConsistency: trendConsistency.toFixed(1),
                consecutiveStrength: consecutiveStrength.toFixed(1)
            }
        };
    }

    // 综合趋势分析
    combineTrendAnalysis(shortTerm, mediumTerm, longTerm) {
        // 权重分配：短期40%，中期35%，长期25%
        const shortWeight = 0.4;
        const mediumWeight = 0.35;
        const longWeight = 0.25;

        // 计算加权平均强度
        const weightedStrength = (
            shortTerm.strength * shortWeight +
            mediumTerm.strength * mediumWeight +
            longTerm.strength * longWeight
        );

        // 趋势一致性判断
        const trends = [shortTerm.trend, mediumTerm.trend, longTerm.trend];
        const trendCounts = {
            increasing: trends.filter(t => t === 'increasing').length,
            decreasing: trends.filter(t => t === 'decreasing').length,
            volatile: trends.filter(t => t === 'volatile').length,
            stable: trends.filter(t => t === 'stable').length
        };

        // 确定主导趋势
        let dominantTrend = 'stable';
        let trendReason = '';

        if (trendCounts.increasing >= 2) {
            dominantTrend = 'increasing';
            trendReason = `强势上升 (短期:${shortTerm.trend}, 中期:${mediumTerm.trend}, 长期:${longTerm.trend})`;
        } else if (trendCounts.decreasing >= 2) {
            dominantTrend = 'decreasing';
            trendReason = `强势下降 (短期:${shortTerm.trend}, 中期:${mediumTerm.trend}, 长期:${longTerm.trend})`;
        } else if (trendCounts.volatile >= 2) {
            dominantTrend = 'volatile';
            trendReason = `高波动性 (短期:${shortTerm.trend}, 中期:${mediumTerm.trend}, 长期:${longTerm.trend})`;
        } else if (trendCounts.stable >= 2) {
            dominantTrend = 'stable';
            trendReason = `趋势稳定 (短期:${shortTerm.trend}, 中期:${mediumTerm.trend}, 长期:${longTerm.trend})`;
        } else {
            // 趋势不一致，根据强度判断
            if (weightedStrength > 40) {
                dominantTrend = 'mixed';
                trendReason = `趋势分化 (强度:${weightedStrength.toFixed(1)}%, 短期:${shortTerm.trend}, 中期:${mediumTerm.trend}, 长期:${longTerm.trend})`;
            } else {
                dominantTrend = 'stable';
                trendReason = `趋势不明显 (强度:${weightedStrength.toFixed(1)}%)`;
            }
        }

        return {
            trend: dominantTrend,
            strength: weightedStrength,
            reason: trendReason,
            details: {
                shortTerm: shortTerm,
                mediumTerm: mediumTerm,
                longTerm: longTerm,
                trendCounts: trendCounts,
                weightedStrength: weightedStrength.toFixed(1)
            }
        };
    }

    // 重新设计：异常趋势分析 - 只关注放量异常
    checkConsecutiveAbnormal(volumeLevel, percentageChange) {
        const currentTime = Date.now();
        const isAbnormal = Math.abs(percentageChange) > 30;
        const isSurge = percentageChange > 30; // 只关注放量异常
        const currentType = percentageChange > 0 ? 'surge' : 'shrink';
        const abnormalIntensity = Math.abs(percentageChange);
        
        // 只记录放量异常历史
        if (isAbnormal && isSurge) {
            this.abnormalHistory = this.abnormalHistory || [];
            this.abnormalHistory.push({
                timestamp: currentTime,
                type: currentType,
                intensity: abnormalIntensity,
                percentageChange: percentageChange,
                volumeLevel: volumeLevel
            });
            
            // 只保留最近10次异常记录
            if (this.abnormalHistory.length > 10) {
                this.abnormalHistory.shift();
            }
        }
        
        // 分析异常趋势（只针对放量异常）
        const trendAnalysis = this.analyzeAbnormalTrend();
        
        // 更新连续异常计数（只计算放量异常）
        if (isAbnormal && isSurge) {
            if (this.lastAbnormalType === 'surge') {
                this.consecutiveAbnormalCount++;
            } else {
                this.consecutiveAbnormalCount = 1;
                this.lastAbnormalType = 'surge';
            }
        } else {
            // 如果是缩量异常，重置计数
            this.consecutiveAbnormalCount = 0;
            this.lastAbnormalType = null;
        }

        return {
            consecutiveCount: this.consecutiveAbnormalCount,
            type: this.lastAbnormalType,
            isConsecutive: this.consecutiveAbnormalCount >= 2,
            trendAnalysis: trendAnalysis,
            currentIntensity: abnormalIntensity,
            abnormalHistory: this.abnormalHistory || [],
            isSurge: isSurge // 新增：标识是否为放量异常
        };
    }

    // 新增：异常趋势分析
    analyzeAbnormalTrend() {
        if (!this.abnormalHistory || this.abnormalHistory.length < 2) {
            return {
                trend: 'insufficient',
                strength: 0,
                pattern: 'none',
                reason: '异常历史数据不足',
                details: {
                    abnormalCount: this.abnormalHistory ? this.abnormalHistory.length : 0,
                    requiredCount: 2
                }
            };
        }

        const recentAbnormals = this.abnormalHistory.slice(-5); // 最近5次异常
        const currentTime = Date.now();
        
        // 1. 异常强度趋势分析
        const intensityTrend = this.analyzeIntensityTrend(recentAbnormals);
        
        // 2. 异常频率分析
        const frequencyAnalysis = this.analyzeAbnormalFrequency(recentAbnormals, currentTime);
        
        // 3. 异常模式识别
        const patternAnalysis = this.analyzeAbnormalPattern(recentAbnormals);
        
        // 4. 时间序列分析
        const timeSeriesAnalysis = this.analyzeTimeSeries(recentAbnormals);
        
        // 5. 综合趋势判断
        const comprehensiveTrend = this.combineAbnormalTrends(
            intensityTrend, 
            frequencyAnalysis, 
            patternAnalysis, 
            timeSeriesAnalysis
        );
        
        return comprehensiveTrend;
    }

    // 异常强度趋势分析
    analyzeIntensityTrend(abnormals) {
        if (abnormals.length < 2) return { trend: 'insufficient', strength: 0 };
        
        const intensities = abnormals.map(a => a.intensity);
        let increasingCount = 0;
        let decreasingCount = 0;
        let totalChange = 0;
        
        for (let i = 1; i < intensities.length; i++) {
            const change = intensities[i] - intensities[i-1];
            totalChange += change;
            if (change > 0) increasingCount++;
            else if (change < 0) decreasingCount++;
        }
        
        const avgChange = totalChange / (intensities.length - 1);
        const trendStrength = Math.abs(avgChange) / (Math.max(...intensities) * 0.1); // 相对强度
        
        let trend = 'stable';
        if (increasingCount > decreasingCount && trendStrength > 0.3) {
            trend = 'intensifying';
        } else if (decreasingCount > increasingCount && trendStrength > 0.3) {
            trend = 'weakening';
        }
        
        return {
            trend: trend,
            strength: Math.min(trendStrength * 100, 100),
            avgChange: avgChange,
            increasingCount: increasingCount,
            decreasingCount: decreasingCount
        };
    }

    // 异常频率分析
    analyzeAbnormalFrequency(abnormals, currentTime) {
        if (abnormals.length < 2) return { frequency: 'low', score: 0 };
        
        const timeIntervals = [];
        for (let i = 1; i < abnormals.length; i++) {
            const interval = abnormals[i].timestamp - abnormals[i-1].timestamp;
            timeIntervals.push(interval);
        }
        
        const avgInterval = timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length;
        const recentInterval = currentTime - abnormals[abnormals.length - 1].timestamp;
        
        // 频率评分：间隔越短，频率越高
        const frequencyScore = Math.max(0, 100 - (avgInterval / 60000)); // 基于分钟计算
        
        let frequency = 'low';
        if (frequencyScore > 70) frequency = 'very_high';
        else if (frequencyScore > 50) frequency = 'high';
        else if (frequencyScore > 30) frequency = 'medium';
        
        return {
            frequency: frequency,
            score: frequencyScore,
            avgInterval: avgInterval / 60000, // 转换为分钟
            recentInterval: recentInterval / 60000
        };
    }

    // 异常模式识别
    analyzeAbnormalPattern(abnormals) {
        if (abnormals.length < 3) return { pattern: 'none', confidence: 0 };
        
        const types = abnormals.map(a => a.type);
        const intensities = abnormals.map(a => a.intensity);
        
        // 模式1：连续同类型异常
        let consecutiveSameType = 1;
        for (let i = types.length - 1; i > 0; i--) {
            if (types[i] === types[i-1]) consecutiveSameType++;
            else break;
        }
        
        // 模式2：交替异常
        let alternatingCount = 0;
        for (let i = 1; i < types.length; i++) {
            if (types[i] !== types[i-1]) alternatingCount++;
        }
        
        // 模式3：强度递增/递减
        let intensityPattern = 'stable';
        let intensityConsistency = 0;
        for (let i = 1; i < intensities.length; i++) {
            if (intensities[i] > intensities[i-1]) intensityConsistency++;
            else if (intensities[i] < intensities[i-1]) intensityConsistency--;
        }
        
        if (intensityConsistency > 0) intensityPattern = 'increasing';
        else if (intensityConsistency < 0) intensityPattern = 'decreasing';
        
        // 确定主导模式
        let pattern = 'random';
        let confidence = 0;
        
        if (consecutiveSameType >= 3) {
            pattern = 'consecutive_same';
            confidence = Math.min(consecutiveSameType * 25, 100);
        } else if (alternatingCount >= types.length - 1) {
            pattern = 'alternating';
            confidence = Math.min(alternatingCount * 20, 100);
        } else if (Math.abs(intensityConsistency) >= intensities.length - 1) {
            pattern = intensityPattern;
            confidence = Math.min(Math.abs(intensityConsistency) * 20, 100);
        }
        
        return {
            pattern: pattern,
            confidence: confidence,
            consecutiveSameType: consecutiveSameType,
            alternatingCount: alternatingCount,
            intensityPattern: intensityPattern
        };
    }

    // 时间序列分析
    analyzeTimeSeries(abnormals) {
        if (abnormals.length < 3) return { trend: 'insufficient', volatility: 0 };
        
        const timestamps = abnormals.map(a => a.timestamp);
        const intensities = abnormals.map(a => a.intensity);
        
        // 计算时间间隔的变异系数
        const intervals = [];
        for (let i = 1; i < timestamps.length; i++) {
            intervals.push(timestamps[i] - timestamps[i-1]);
        }
        
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const intervalVariance = intervals.reduce((sum, interval) => {
            return sum + Math.pow(interval - avgInterval, 2);
        }, 0) / intervals.length;
        const intervalStdDev = Math.sqrt(intervalVariance);
        const intervalCV = intervalStdDev / avgInterval; // 变异系数
        
        // 计算强度的时间趋势
        const timeTrend = this.calculateTimeTrend(timestamps, intensities);
        
        return {
            trend: timeTrend.trend,
            volatility: Math.min(intervalCV * 100, 100),
            avgInterval: avgInterval / 60000, // 分钟
            intervalCV: intervalCV,
            timeSlope: timeTrend.slope
        };
    }

    // 计算时间趋势
    calculateTimeTrend(timestamps, values) {
        const n = timestamps.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += timestamps[i];
            sumY += values[i];
            sumXY += timestamps[i] * values[i];
            sumX2 += timestamps[i] * timestamps[i];
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const trend = slope > 0.0001 ? 'increasing' : slope < -0.0001 ? 'decreasing' : 'stable';
        
        return { trend, slope };
    }

    // 综合异常趋势分析
    combineAbnormalTrends(intensityTrend, frequencyAnalysis, patternAnalysis, timeSeriesAnalysis) {
        // 权重分配
        const weights = {
            intensity: 0.35,
            frequency: 0.25,
            pattern: 0.25,
            timeSeries: 0.15
        };
        
        // 计算综合强度
        const combinedStrength = (
            intensityTrend.strength * weights.intensity +
            frequencyAnalysis.score * weights.frequency +
            patternAnalysis.confidence * weights.pattern +
            (100 - timeSeriesAnalysis.volatility) * weights.timeSeries
        );
        
        // 确定主导趋势
        let dominantTrend = 'stable';
        let trendReason = '';
        
        if (intensityTrend.trend === 'intensifying' && combinedStrength > 60) {
            dominantTrend = 'intensifying';
            trendReason = `异常强度递增趋势 (强度:${intensityTrend.strength.toFixed(1)}%, 频率:${frequencyAnalysis.frequency})`;
        } else if (intensityTrend.trend === 'weakening' && combinedStrength > 60) {
            dominantTrend = 'weakening';
            trendReason = `异常强度递减趋势 (强度:${intensityTrend.strength.toFixed(1)}%, 频率:${frequencyAnalysis.frequency})`;
        } else if (frequencyAnalysis.frequency === 'very_high' && combinedStrength > 50) {
            dominantTrend = 'high_frequency';
            trendReason = `高频异常模式 (频率:${frequencyAnalysis.score.toFixed(1)}%, 模式:${patternAnalysis.pattern})`;
        } else if (patternAnalysis.pattern !== 'random' && patternAnalysis.confidence > 60) {
            dominantTrend = 'patterned';
            trendReason = `规律性异常模式 (模式:${patternAnalysis.pattern}, 置信度:${patternAnalysis.confidence.toFixed(1)}%)`;
        } else if (combinedStrength > 40) {
            dominantTrend = 'moderate';
            trendReason = `中等异常趋势 (综合强度:${combinedStrength.toFixed(1)}%)`;
        } else {
            trendReason = `异常趋势不明显 (综合强度:${combinedStrength.toFixed(1)}%)`;
        }
        
        return {
            trend: dominantTrend,
            strength: combinedStrength,
            reason: trendReason,
            details: {
                intensityTrend: intensityTrend,
                frequencyAnalysis: frequencyAnalysis,
                patternAnalysis: patternAnalysis,
                timeSeriesAnalysis: timeSeriesAnalysis,
                weights: weights
            }
        };
    }

    // 新增：噪音过滤 - 智能阈值调整
    getDynamicThreshold() {
        const baseThreshold = 30;
        
        // 根据连续异常次数调整阈值
        if (this.consecutiveAbnormalCount >= 3) {
            return baseThreshold * 0.8; // 降低阈值，更容易触发警报
        } else if (this.consecutiveAbnormalCount === 0) {
            return baseThreshold * 1.2; // 提高阈值，减少噪音
        }
        
        return baseThreshold;
    }

    // 新增：综合趋势分析 - 只推送放量异常
    analyzeComprehensiveTrend(currentBuyVolume) {
        // 先更新买入量历史，确保趋势分析有足够数据
        this.updateVolumeHistory(currentBuyVolume);
        
        const basicAnalysis = this.analyzeVolume(currentBuyVolume);
        const volumeTrend = this.analyzeVolumeTrend();
        const consecutiveInfo = this.checkConsecutiveAbnormal(basicAnalysis.volumeLevel, basicAnalysis.percentageChange);
        const dynamicThreshold = this.getDynamicThreshold();
        
        // 计算综合评分
        let confidenceScore = 0;
        let shouldAlert = false;
        
        // 基础异常判断 - 只关注买入量放量异常
        const isBasicAbnormal = basicAnalysis.percentageChange > dynamicThreshold; // 只检查正数（放量）
        
        // 新增：200%以上极端买入量放量立即推送
        const isExtremeSurge = basicAnalysis.percentageChange > 200;
        
        if (isExtremeSurge) {
            // 极端买入量放量（200%以上）立即推送，不需要连续异常判断
            shouldAlert = true;
            confidenceScore = 100; // 给予最高评分
        } else if (isBasicAbnormal) {
            confidenceScore += 30;
            
            // 连续异常加分 - 重点考虑连续买入量放量异常
            if (consecutiveInfo.isConsecutive) {
                confidenceScore += consecutiveInfo.consecutiveCount * 25; // 增加连续异常的权重
            }
            
            // 新增：买入量异常趋势分析加分
            if (consecutiveInfo.trendAnalysis && consecutiveInfo.trendAnalysis.trend !== 'insufficient') {
                const trendAnalysis = consecutiveInfo.trendAnalysis;
                
                // 根据买入量异常趋势类型加分
                switch (trendAnalysis.trend) {
                    case 'intensifying':
                        confidenceScore += 30; // 买入量异常强度递增，重点关注
                        break;
                    case 'high_frequency':
                        confidenceScore += 25; // 高频买入量异常，需要关注
                        break;
                    case 'patterned':
                        confidenceScore += 20; // 规律性买入量异常
                        break;
                    case 'moderate':
                        confidenceScore += 15; // 中等买入量异常趋势
                        break;
                    case 'weakening':
                        confidenceScore += 10; // 买入量异常强度递减
                        break;
                }
                
                // 根据买入量趋势强度额外加分
                if (trendAnalysis.strength > 70) {
                    confidenceScore += 15;
                } else if (trendAnalysis.strength > 50) {
                    confidenceScore += 10;
                } else if (trendAnalysis.strength > 30) {
                    confidenceScore += 5;
                }
            }
            
                    // 买入量趋势一致性加分 - 只关注上升趋势
        if (volumeTrend.trend === 'increasing' && basicAnalysis.percentageChange > 0) {
            confidenceScore += 15;
        } else if (volumeTrend.trend === 'volatile' && basicAnalysis.percentageChange > 50) {
            confidenceScore += 10;
        }
        
        // 买入量趋势强度加分
        if (volumeTrend.strength > 0) {
            confidenceScore += Math.min(volumeTrend.strength * 0.3, 20);
        }
            
            // 历史数据充分性加分
            if (basicAnalysis.historicalCount >= 20) {
                confidenceScore += 10;
            }
            
            // 关键修改：基于买入量异常趋势分析的智能警报判断 - 只推送放量异常
            const hasStrongTrend = consecutiveInfo.trendAnalysis && 
                                 consecutiveInfo.trendAnalysis.trend !== 'insufficient' && 
                                 consecutiveInfo.trendAnalysis.strength > 50;
            
            const hasConsecutiveAbnormal = consecutiveInfo.consecutiveCount >= 2;
            
            // 新的警报逻辑：需要连续买入量放量异常 + 强趋势 或 高综合评分
            shouldAlert = (hasConsecutiveAbnormal && hasStrongTrend) || 
                         (consecutiveInfo.consecutiveCount >= 3 && confidenceScore >= 60) ||
                         (consecutiveInfo.consecutiveCount >= 2 && confidenceScore >= 80);
        }

        return {
            ...basicAnalysis,
            volumeTrend: volumeTrend,
            consecutiveInfo: consecutiveInfo,
            dynamicThreshold: dynamicThreshold,
            confidenceScore: Math.min(confidenceScore, 100),
            shouldAlert: shouldAlert,
            trendStrength: volumeTrend.strength,
            trendReason: volumeTrend.reason,
            abnormalTrendAnalysis: consecutiveInfo.trendAnalysis,
            isSurgeAlert: shouldAlert, // 新增：标识是否为放量警报
            isExtremeSurge: isExtremeSurge // 新增：标识是否为极端放量（200%以上）
        };
    }

    // 计算当前30根K线的平均成交量
    calculateAverageVolume() {
        if (this.klines.length === 0) return 0;
        
        // 只使用已完成的K线计算均值（排除最后一根可能正在进行的K线）
        const completedKlines = this.klines.slice(0, -1);
        if (completedKlines.length === 0) return 0;
        
        const totalVolume = completedKlines.reduce((sum, kline) => {
            return sum + parseFloat(kline.volume);
        }, 0);
        
        return totalVolume / completedKlines.length;
    }

    // 获取详细的成交量统计信息
    getVolumeStats() {
        if (this.klines.length === 0) return null;

        // 使用已完成的K线
        const completedKlines = this.klines.slice(0, -1);
        if (completedKlines.length === 0) return null;

        const volumes = completedKlines.map(k => parseFloat(k.volume));
        const avgVolume = this.calculateAverageVolume();
        const maxVolume = Math.max(...volumes);
        const minVolume = Math.min(...volumes);

        return {
            average: avgVolume,
            max: maxVolume,
            min: minVolume,
            count: completedKlines.length,
            latest: volumes[volumes.length - 1],
            windowSize: this.klines.length
        };
    }
    // 分析当前买入量相对于历史均值成交量的情况
    analyzeVolume(currentBuyVolume) {
        const stats = this.getVolumeStats();
        if (!stats || stats.count < 5) { // 至少需要5根历史K线才能分析
            return {
                symbol: this.symbol,
                currentBuyVolume,
                averageVolume: 0,
                difference: 0,
                percentageChange: 0,
                volumeLevel: '数据不足',
                isAboveAverage: false,
                historicalCount: stats ? stats.count : 0
            };
        }

        const avgVolume = stats.average;
        const difference = currentBuyVolume - avgVolume;
        const percentageChange = (difference / avgVolume) * 100;

        let volumeLevel = '正常';
        if (percentageChange > 200) {
            volumeLevel = '极端放量'; // 新增：200%以上为极端放量
        } else if (percentageChange > 100) {
            volumeLevel = '剧烈放量'; // 新增：100-200%为剧烈放量
        } else if (percentageChange > 50) {
            volumeLevel = '异常放量';
        } else if (percentageChange > 20) {
            volumeLevel = '明显放量';
        } else if (percentageChange > 10) {
            volumeLevel = '轻微放量';
        } else if (percentageChange < -30) {
            volumeLevel = '异常缩量';
        } else if (percentageChange < -15) {
            volumeLevel = '明显缩量';
        } else if (percentageChange < -5) {
            volumeLevel = '轻微缩量';
        }

        return {
            symbol: this.symbol,
            currentBuyVolume,
            averageVolume: avgVolume,
            difference,
            percentageChange,
            volumeLevel,
            isAboveAverage: currentBuyVolume > avgVolume,
            historicalCount: stats.count
        };
    }

    // 获取当前状态摘要
    getStatusSummary() {
        const stats = this.getVolumeStats();
        return {
            symbol: this.symbol,
            initialized: this.isInitialized,
            klineCount: this.klines.length,
            completedKlineCount: stats ? stats.count : 0,
            averageVolume: stats ? stats.average.toFixed(0) : '0',
            lastUpdate: new Date(this.lastUpdateTime).toLocaleString('zh-CN')
        };
    }

    // 新增：比较当前K线买入量与历史均值成交量
    compareBuyVolumeWithAverageVolume(currentBuyVolume) {
        if (this.klines.length === 0) {
            return {
                symbol: this.symbol,
                currentBuyVolume: 0,
                averageVolume: 0,
                difference: 0,
                percentageChange: 0,
                comparison: '数据不足',
                isAboveAverage: false,
                historicalCount: 0,
                message: '暂无K线数据'
            };
        }

        // 使用已完成的K线计算均值（排除最后一根可能正在进行的K线）
        const completedKlines = this.klines.slice(0, -1);
        if (completedKlines.length === 0) {
            return {
                symbol: this.symbol,
                currentBuyVolume: currentBuyVolume,
                averageVolume: 0,
                difference: 0,
                percentageChange: 0,
                comparison: '数据不足',
                isAboveAverage: false,
                historicalCount: 0,
                message: '暂无已完成的K线数据'
            };
        }

        // 计算历史K线的平均成交量
        const totalVolume = completedKlines.reduce((sum, kline) => {
            return sum + parseFloat(kline.volume);
        }, 0);
        const averageVolume = totalVolume / completedKlines.length;

        // 计算差异和百分比变化
        const difference = currentBuyVolume - averageVolume;
        const percentageChange = (difference / averageVolume) * 100;

        // 判断比较结果
        let comparison = '正常';
        let message = '';
        
        if (percentageChange > 200) {
            comparison = '极端放量';
            message = '当前买入量远超历史均值，可能存在重大利好或资金大量涌入';
        } else if (percentageChange > 100) {
            comparison = '剧烈放量';
            message = '当前买入量显著高于历史均值，显示强烈的买入意愿';
        } else if (percentageChange > 50) {
            comparison = '异常放量';
            message = '当前买入量明显高于历史均值，可能存在异常情况';
        } else if (percentageChange > 20) {
            comparison = '明显放量';
            message = '当前买入量高于历史均值，显示一定的买入压力';
        } else if (percentageChange > 10) {
            comparison = '轻微放量';
            message = '当前买入量略高于历史均值，买入意愿有所增强';
        } else if (percentageChange < -30) {
            comparison = '异常缩量';
            message = '当前买入量明显低于历史均值，买入意愿显著减弱';
        } else if (percentageChange < -15) {
            comparison = '明显缩量';
            message = '当前买入量低于历史均值，买入意愿有所减弱';
        } else if (percentageChange < -5) {
            comparison = '轻微缩量';
            message = '当前买入量略低于历史均值，买入意愿略有减弱';
        } else {
            comparison = '正常水平';
            message = '当前买入量与历史均值基本持平，市场表现正常';
        }

        return {
            symbol: this.symbol,
            currentBuyVolume: currentBuyVolume,
            averageVolume: averageVolume,
            difference: difference,
            percentageChange: percentageChange,
            comparison: comparison,
            isAboveAverage: currentBuyVolume > averageVolume,
            historicalCount: completedKlines.length,
            message: message,
            // 添加详细信息
            details: {
                historicalVolumes: completedKlines.map(k => parseFloat(k.volume)),
                maxVolume: Math.max(...completedKlines.map(k => parseFloat(k.volume))),
                minVolume: Math.min(...completedKlines.map(k => parseFloat(k.volume))),
                volumeStdDev: this.calculateVolumeStandardDeviation(completedKlines.map(k => parseFloat(k.volume)))
            }
        };
    }

    // 计算成交量的标准差
    calculateVolumeStandardDeviation(volumes) {
        if (volumes.length < 2) return 0;
        
        const mean = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        const squaredDiffs = volumes.map(vol => Math.pow(vol - mean, 2));
        const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / volumes.length;
        
        return Math.sqrt(variance);
    }
}

// 创建多币种管理器实例
const multiManager = new MultiSymbolKlineManager();

// 获取单个币种的历史K线数据（优化版本）
async function fetchHistoricalKlines(symbol) {
    try {
        const response = await axiosInstance.get(CONFIG.apiUrl, {
            params: {
                symbol: symbol,
                interval: CONFIG.interval,
                limit: CONFIG.historyLimit
            },
            timeout: 15000 // 增加超时时间
        });

        const historicalKlines = response.data.map(kline => ({
            openTime: parseInt(kline[0]),
            closeTime: parseInt(kline[6]),
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
            quoteVolume: parseFloat(kline[7]),
            trades: parseInt(kline[8])
        }));

        const klineManager = multiManager.getKlineManager(symbol);
        if (klineManager) {
            // 添加历史K线数据
            historicalKlines.forEach(kline => {
                klineManager.addKline(kline);
            });
            
            // 预填充成交量历史记录
            const recentKlines = historicalKlines.slice(-10);
            recentKlines.forEach(kline => {
                klineManager.updateVolumeHistory(kline.volume);
            });
            
            klineManager.isInitialized = true;

            const stats = klineManager.getVolumeStats();
            if (stats) {
                console.log(`✅ ${symbol} 数据加载完成 - 平均成交量: ${stats.average.toFixed(2)}`);
            }
        }

        return true;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            // 遇到速率限制，等待后重试
            console.log(`⏳ ${symbol} 遇到速率限制，等待重试...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await fetchHistoricalKlines(symbol);
        } else {
            console.error(`❌ ${symbol} 历史数据获取失败:`, error.message);
            return false;
        }
    }
}

// 处理完成的K线数据
async function handleCompletedKline(symbol, klineData) {
    const klineManager = multiManager.getKlineManager(symbol);
    if (!klineManager || !klineManager.isInitialized) {
        return;
    }

    // 使用新的综合趋势分析方法
    const analysis = klineManager.analyzeComprehensiveTrend(klineData.buyVolume || 0);
    
    // 新增：比较当前K线买入量与历史均值成交量
    const buyVolumeComparison = klineManager.compareBuyVolumeWithAverageVolume(klineData.buyVolume);
    
    if (analysis) {
        const timeStr = new Date(klineData.closeTime).toLocaleString('zh-CN');
        const priceChange = klineData.close > klineData.open ? '📈' : '📉';
        const priceChangePercent = ((klineData.close - klineData.open) / klineData.open * 100).toFixed(2);
        
        // 使用新的智能警报判断
        const shouldAlert = analysis.shouldAlert;
        
        if (shouldAlert) {
            // 高置信度放量异常：获取详细信息并整合显示
            const tokenDetails = await getCachedTokenDetails(symbol);
            
            // 控制台输出
            console.log(`\n🚨 ====== ${symbol} 连续放量异常警报 ======`);
            console.log(`⏰ 时间: ${timeStr}`);
            console.log(`💰 价格变化: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
            console.log(`📊 买入量异常: ${analysis.currentBuyVolume.toFixed(0)} | 30根均值成交量: ${analysis.averageVolume.toFixed(0)}`);
            console.log(`📊 异常程度: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}`);
            console.log(`📊 历史数据: ${analysis.historicalCount}根K线`);
            console.log(`🎯 综合评分: ${analysis.confidenceScore.toFixed(1)}/100`);
            console.log(`🔄 连续放量: ${analysis.consecutiveInfo.consecutiveCount}次`);
            console.log(`📈 买入量趋势: ${analysis.volumeTrend.trend} (强度: ${analysis.volumeTrend.strength.toFixed(1)}%)`);
            console.log(`📊 趋势详情: ${analysis.trendReason}`);
            
            // 新增：显示买入量与均值成交量比较
            console.log(`\n📈 ====== 买入量分析 ======`);
            console.log(`📊 当前买入量: ${buyVolumeComparison.currentBuyVolume.toFixed(0)}`);
            console.log(`📊 历史均值成交量: ${buyVolumeComparison.averageVolume.toFixed(0)}`);
            console.log(`📊 差异: ${buyVolumeComparison.difference > 0 ? '+' : ''}${buyVolumeComparison.difference.toFixed(0)}`);
            console.log(`📊 变化百分比: ${buyVolumeComparison.percentageChange > 0 ? '+' : ''}${buyVolumeComparison.percentageChange.toFixed(1)}%`);
            console.log(`📊 比较结果: ${buyVolumeComparison.comparison}`);
            console.log(`📊 分析说明: ${buyVolumeComparison.message}`);
            console.log(`📊 历史K线数量: ${buyVolumeComparison.historicalCount}根`);
            if (buyVolumeComparison.details) {
                console.log(`📊 历史最高成交量: ${buyVolumeComparison.details.maxVolume.toFixed(0)}`);
                console.log(`📊 历史最低成交量: ${buyVolumeComparison.details.minVolume.toFixed(0)}`);
                console.log(`📊 成交量标准差: ${buyVolumeComparison.details.volumeStdDev.toFixed(0)}`);
            }
            
            // 新增：异常趋势分析显示
            if (analysis.abnormalTrendAnalysis && analysis.abnormalTrendAnalysis.trend !== 'insufficient') {
                const abnormalTrend = analysis.abnormalTrendAnalysis;
                console.log(`\n🔍 放量异常趋势分析:`);
                console.log(`📊 异常趋势: ${abnormalTrend.trend} (强度: ${abnormalTrend.strength.toFixed(1)}%)`);
                console.log(`📊 趋势原因: ${abnormalTrend.reason}`);
                
                if (abnormalTrend.details) {
                    const details = abnormalTrend.details;
                    console.log(`📊 强度趋势: ${details.intensityTrend.trend} (${details.intensityTrend.strength.toFixed(1)}%)`);
                    console.log(`📊 异常频率: ${details.frequencyAnalysis.frequency} (${details.frequencyAnalysis.score.toFixed(1)}%)`);
                    console.log(`📊 异常模式: ${details.patternAnalysis.pattern} (置信度: ${details.patternAnalysis.confidence.toFixed(1)}%)`);
                    console.log(`📊 时间序列: ${details.timeSeriesAnalysis.trend} (波动性: ${details.timeSeriesAnalysis.volatility.toFixed(1)}%)`);
                }
            }
            
            if (analysis.volumeTrend.details && analysis.volumeTrend.details.shortTerm) {
                console.log(`📊 短期买入量趋势: ${analysis.volumeTrend.details.shortTerm.reason}`);
                console.log(`📊 中期买入量趋势: ${analysis.volumeTrend.details.mediumTerm.reason}`);
                console.log(`📊 长期买入量趋势: ${analysis.volumeTrend.details.longTerm.reason}`);
            }
            console.log(`⚡ 动态阈值: ${analysis.dynamicThreshold.toFixed(1)}%`);
            
            if (tokenDetails) {
                console.log(`\n📋 ${symbol} 币种信息:`);
                console.log(`${'─'.repeat(50)}`);
                
                // 显示合约信息
                if (tokenDetails.contractInfo) {
                    const onboardDate = new Date(tokenDetails.contractInfo.onboardDate).toLocaleString('zh-CN');
                    console.log(`📅 合约上线时间: ${onboardDate}`);
                    console.log(`📊 合约状态: ${tokenDetails.contractInfo.status}`);
                    console.log(`📋 合约类型: ${tokenDetails.contractInfo.contractType}`);
                } else {
                    console.log(`❌ 合约信息获取失败`);
                }
                
                // 显示持仓量信息
                if (tokenDetails.openInterest) {
                    const oiTime = new Date(tokenDetails.openInterest.timestamp).toLocaleString('zh-CN');
                    const oiValue = (parseFloat(tokenDetails.openInterest.openInterestValue) / 1000000).toFixed(2);
                    console.log(`📈 当前持仓量: ${tokenDetails.openInterest.openInterest}`);
                    console.log(`💰 持仓总价值: ${oiValue}M USDT`);
                    console.log(`⏰ 数据时间: ${oiTime}`);
                } else {
                    console.log(`❌ 持仓量信息获取失败`);
                }
                
                console.log(`${'─'.repeat(50)}`);
            } else {
                console.log(`❌ 无法获取 ${symbol} 详细信息`);
            }
            
            console.log(`🔥 连续放量异常警报: ${symbol} 连续${analysis.consecutiveInfo.consecutiveCount}次异常放量！`);
            console.log(`==========================================`);
            
            // 构建Telegram消息
            let telegramMessage = `🚨 ${symbol} 连续放量异常警报\n\n`;
            telegramMessage += `⏰ 时间: ${timeStr}\n`;
            telegramMessage += `💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)\n`;
            telegramMessage += `📊 买入量: ${analysis.currentBuyVolume.toFixed(0)} | 30根均值成交量: ${analysis.averageVolume.toFixed(0)}\n`;
            telegramMessage += `📊 异常程度: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}\n`;
            telegramMessage += `🎯 综合评分: ${analysis.confidenceScore.toFixed(1)}/100\n`;
            telegramMessage += `🔄 连续放量: ${analysis.consecutiveInfo.consecutiveCount}次\n`;
            telegramMessage += `📈 趋势: ${analysis.volumeTrend.trend} (强度: ${analysis.volumeTrend.strength.toFixed(1)}%)\n`;
            
            // 新增：买入量比较信息到Telegram消息
            telegramMessage += `\n📈 买入量分析:\n`;
            telegramMessage += `📊 买入量: ${buyVolumeComparison.currentBuyVolume.toFixed(0)} | 均值: ${buyVolumeComparison.averageVolume.toFixed(0)}\n`;
            telegramMessage += `📊 变化: ${buyVolumeComparison.percentageChange > 0 ? '+' : ''}${buyVolumeComparison.percentageChange.toFixed(1)}% | ${buyVolumeComparison.comparison}\n`;
            telegramMessage += `📊 说明: ${buyVolumeComparison.message}\n`;
            
            // 新增：异常趋势分析到Telegram消息
            if (analysis.abnormalTrendAnalysis && analysis.abnormalTrendAnalysis.trend !== 'insufficient') {
                const abnormalTrend = analysis.abnormalTrendAnalysis;
                telegramMessage += `🔍 放量趋势: ${abnormalTrend.trend} (强度: ${abnormalTrend.strength.toFixed(1)}%)\n`;
                telegramMessage += `📊 趋势分析: ${abnormalTrend.reason}\n`;
            }
            
            telegramMessage += `\n`;
            
            if (tokenDetails) {
                telegramMessage += `📋 币种信息:\n`;
                
                if (tokenDetails.contractInfo) {
                    const onboardDate = new Date(tokenDetails.contractInfo.onboardDate).toLocaleString('zh-CN');
                    telegramMessage += `📅 合约上线: ${onboardDate}\n`;
                    telegramMessage += `📊 合约状态: ${tokenDetails.contractInfo.status}\n`;
                }
                
                if (tokenDetails.openInterest) {
                    const oiValue = (parseFloat(tokenDetails.openInterest.openInterestValue) / 1000000).toFixed(2);
                    telegramMessage += `📈 当前持仓量: ${tokenDetails.openInterest.openInterest}\n`;
                    telegramMessage += `💰 持仓总价值: ${oiValue}M USDT\n`;
                }
                
                telegramMessage += `\n`;
            }
            
            telegramMessage += `🔥 连续放量异常警报: ${symbol} 连续${analysis.consecutiveInfo.consecutiveCount}次异常放量！`;
            
            // 发送到Telegram
            enqueueTelegramMessage(telegramMessage);
            
        } else if (analysis.percentageChange > 20) {
            // 中等放量异常：简单显示，不发送Telegram
            console.log(`\n⚠️ ${symbol} 中等放量异常 | ${timeStr}`);
            console.log(`💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
            console.log(`📊 成交量: ${analysis.currentVolume.toFixed(0)} | 30根均值: ${analysis.averageVolume.toFixed(0)}`);
            console.log(`📊 变化: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}`);
            console.log(`🎯 综合评分: ${analysis.confidenceScore.toFixed(1)}/100 (未达到连续放量阈值)`);
            console.log(`🔄 连续放量: ${analysis.consecutiveInfo.consecutiveCount}次 (需要≥2次才推送)`);
            console.log(`📈 趋势: ${analysis.volumeTrend.trend} (强度: ${analysis.volumeTrend.strength.toFixed(1)}%)`);
            
            // 显示异常趋势分析（如果有）
            if (analysis.abnormalTrendAnalysis && analysis.abnormalTrendAnalysis.trend !== 'insufficient') {
                const abnormalTrend = analysis.abnormalTrendAnalysis;
                console.log(`🔍 放量趋势: ${abnormalTrend.trend} (强度: ${abnormalTrend.strength.toFixed(1)}%)`);
            }
        } else {
            // 正常成交量或缩量：简单显示
            console.log(`\n✅ ${symbol} K线完成 | ${timeStr}`);
            console.log(`💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
            console.log(`📊 成交量: ${analysis.currentVolume.toFixed(0)} | 30根均值: ${analysis.averageVolume.toFixed(0)}`);
            console.log(`📊 变化: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}`);
            if (analysis.consecutiveInfo.consecutiveCount > 0) {
                console.log(`🔄 连续放量: ${analysis.consecutiveInfo.consecutiveCount}次 (需要≥2次才推送)`);
            }
        }
        
        console.log(`${'='.repeat(60)}`);
    }
}

// 处理进行中的K线数据 (每30秒显示一次)
let lastOngoingUpdate = {};

function handleOngoingKline(symbol, klineData) {
    const klineManager = multiManager.getKlineManager(symbol);
    if (!klineManager || !klineManager.isInitialized) {
        return;
    }

    // 控制输出频率：每币种每30秒显示一次
    const now = Date.now();
    const lastUpdate = lastOngoingUpdate[symbol] || 0;
    if (now - lastUpdate < 30000) { // 30秒内不重复显示
        return;
    }
    lastOngoingUpdate[symbol] = now;

    const currentBuyVolume = parseFloat(klineData.buyVolume || 0);
    const analysis = klineManager.analyzeVolume(currentBuyVolume);

    if (analysis && analysis.historicalCount >= 5) {
        const timeStr = new Date(klineData.closeTime).toLocaleString('zh-CN');
        const priceChange = klineData.close > klineData.open ? '📈' : '📉';
        const priceChangePercent = ((klineData.close - klineData.open) / klineData.open * 100).toFixed(2);

        // 获取买入量与历史均值的比较
        const buyVolumeComparison = klineManager.compareBuyVolumeWithAverageVolume(currentBuyVolume);
        
        // 实时分析数据显示
        console.log(`\n📊 ====== ${symbol} 实时分析 ======`);
        console.log(`⏰ 时间: ${timeStr}`);
        console.log(`💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
        console.log(`📊 当前买入量: ${currentBuyVolume.toFixed(0)}`);
        console.log(`📊 历史均值成交量: ${buyVolumeComparison.averageVolume.toFixed(0)}`);
        console.log(`📊 差异: ${buyVolumeComparison.difference > 0 ? '+' : ''}${buyVolumeComparison.difference.toFixed(0)}`);
        console.log(`📊 变化百分比: ${buyVolumeComparison.percentageChange > 0 ? '+' : ''}${buyVolumeComparison.percentageChange.toFixed(1)}%`);
        console.log(`📊 比较结果: ${buyVolumeComparison.comparison}`);
        console.log(`📊 分析说明: ${buyVolumeComparison.message}`);
        console.log(`📊 历史K线数量: ${buyVolumeComparison.historicalCount}根`);
        
        // 显示历史成交量统计
        if (buyVolumeComparison.details) {
            console.log(`📊 历史最高成交量: ${buyVolumeComparison.details.maxVolume.toFixed(0)}`);
            console.log(`📊 历史最低成交量: ${buyVolumeComparison.details.minVolume.toFixed(0)}`);
            console.log(`📊 成交量标准差: ${buyVolumeComparison.details.volumeStdDev.toFixed(0)}`);
        }
        
        // 显示趋势分析
        if (analysis.volumeTrend) {
            console.log(`📈 买入量趋势: ${analysis.volumeTrend.trend} (强度: ${analysis.volumeTrend.strength.toFixed(1)}%)`);
        }
        
        console.log(`${'─'.repeat(50)}`);
    }
}

// 交互式命令行界面


// 批量加载币种从文件
async function loadSymbolsFromFile(filePath) {
    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.error(`❌ 文件不存在: ${filePath}`);
            return [];
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let symbols = [];
        
        // 尝试解析为JSON格式
        try {
            const data = JSON.parse(fileContent);
            if (Array.isArray(data)) {
                symbols = data;
            } else if (data.symbols && Array.isArray(data.symbols)) {
                symbols = data.symbols;
            } else if (data.filteredTradingPairs && Array.isArray(data.filteredTradingPairs)) {
                symbols = data.filteredTradingPairs.map(item => item.tradingPair);
            }
        } catch (e) {
            // 如果不是JSON，尝试解析为JavaScript数组格式
            const match = fileContent.match(/const\s+\w+\s*=\s*\[([\s\S]*?)\];/);
            if (match) {
                const arrayContent = match[1];
                symbols = arrayContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith("'") && line.endsWith("',"))
                    .map(line => line.slice(1, -2));
            } else {
                // 尝试按行分割
                symbols = fileContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('//'))
                    .map(line => line.replace(/['"]/g, ''));
            }
        }
        
        console.log(`📁 从文件 ${filePath} 加载了 ${symbols.length} 个币种`);
        return symbols;
    } catch (error) {
        console.error(`❌ 加载文件失败:`, error.message);
        return [];
    }
}

// 优化后的主函数
async function main() {
    console.log('🚀 启动多币种K线监控系统...');
    
    try {
        // 检查是否有命令行参数
        const args = process.argv.slice(2);
        let symbolsToMonitor = [];
        
        if (args.length > 0) {
            const filePath = args[0];
            console.log(`📁 从命令行参数加载币种文件: ${filePath}`);
            symbolsToMonitor = await loadSymbolsFromFile(filePath);
            
            if (symbolsToMonitor.length === 0) {
                console.log('⚠️ 未能从文件加载币种，使用默认币种列表');
                symbolsToMonitor = CONFIG.defaultSymbols;
            }
        } else {
            // 尝试自动加载最新的筛选结果
            const possibleFiles = [
                path.join(__dirname, 'low_market_cap_trading_pairs.js'),
                path.join(__dirname, 'filtered_trading_pairs_by_market_cap.json'),
                path.join(__dirname, 'trading_pairs.json')
            ];
            
            for (const file of possibleFiles) {
                if (fs.existsSync(file)) {
                    console.log(`📁 自动发现币种文件: ${file}`);
                    symbolsToMonitor = await loadSymbolsFromFile(file);
                    if (symbolsToMonitor.length > 0) {
                        console.log(`✅ 成功加载 ${symbolsToMonitor.length} 个币种`);
                        break;
                    }
                }
            }
            
            if (symbolsToMonitor.length === 0) {
                console.log('⚠️ 未找到币种文件，使用默认币种列表');
                symbolsToMonitor = CONFIG.defaultSymbols;
            }
        }
        
        // 限制最大监控数量，避免系统过载
        const maxSymbols = 1000; // 最大监控1000个币种
        if (symbolsToMonitor.length > maxSymbols) {
            console.log(`⚠️ 币种数量过多 (${symbolsToMonitor.length})，限制为 ${maxSymbols} 个`);
            symbolsToMonitor = symbolsToMonitor.slice(0, maxSymbols);
        }
        
        console.log(`🎯 准备监控 ${symbolsToMonitor.length} 个币种`);
        
        // 使用新的批量添加功能
        const startTime = Date.now();
        const addedCount = await multiManager.addSymbols(symbolsToMonitor);
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);
        
        console.log(`✅ 批量添加完成！成功添加 ${addedCount} 个币种，耗时 ${duration} 秒`);
        
        // 启动定期清理任务
        setInterval(async () => {
            try {
                // 连接健康检查
                const healthReport = await multiManager.checkConnectionHealth();
                if (healthReport.brokenConnections > 0) {
                    console.log(`⚠️ 检测到 ${healthReport.brokenConnections} 个断开的连接，已加入重连队列`);
                }
                
                // 清理和优化
                multiManager.cleanupInactiveConnections();
                multiManager.optimizeMemory();
                
                // 检查是否需要恢复币种监控
                const stats = multiManager.getStats();
                if (stats.totalSymbols === 0) {
                    console.log('⚠️ 检测到监控币种数量为0，尝试恢复币种监控...');
                    await restoreSymbolMonitoring();
                }
                
                // 显示详细统计信息
                const status = multiManager.getConnectionStatus();
                
                console.log(`📊 系统状态报告:`);
                console.log(`   📈 监控币种: ${stats.totalSymbols} 个`);
                console.log(`   🔗 活跃连接: ${stats.activeConnections}/${stats.maxConnections} (${stats.connectionUtilization})`);
                console.log(`   ⏳ 队列长度: ${stats.queuedConnections} 个`);
                console.log(`   📊 连接成功率: ${stats.connectionSuccessRate}`);
                console.log(`   📊 队列效率: ${stats.queueEfficiency}`);
                console.log(`   💾 内存使用: ${stats.memoryUsageMB} MB`);
                console.log(`   ❌ 失败连接: ${stats.failedConnections} 个`);
                console.log(`   🔄 重试次数: ${stats.retryCount} 次`);
                
                // 性能警告
                if (stats.memoryUsageMB > 500) {
                    console.log(`⚠️ 内存使用较高 (${stats.memoryUsageMB}MB)，建议优化`);
                }
                
                if (stats.connectionSuccessRate < 80) {
                    console.log(`⚠️ 连接成功率较低 (${stats.connectionSuccessRate})，请检查网络`);
                }
                
            } catch (error) {
                console.error('❌ 定期任务执行失败:', error.message);
            }
        }, 5 * 60 * 1000); // 每5分钟执行一次
        
        // 启动Telegram消息队列处理
        setInterval(() => {
            if (telegramQueue.length > 0 && !isProcessingTelegramQueue) {
                processTelegramQueue();
            }
        }, 10000); // 每10秒检查一次

        // 启动连接恢复检查任务
        setInterval(async () => {
            try {
                const stats = multiManager.getStats();
                
                // 如果监控币种数量为0，立即尝试恢复
                if (stats.totalSymbols === 0) {
                    console.log('🚨 检测到监控币种数量为0，立即尝试恢复...');
                    await restoreSymbolMonitoring();
                }
                // 如果活跃连接比例过低，尝试重新连接
                else if (stats.activeConnections > 0 && stats.connectionUtilization < 50) {
                    console.log(`⚠️ 连接利用率较低 (${stats.connectionUtilization})，尝试优化连接...`);
                    await multiManager.reconnectCleanedSymbols();
                }
                
            } catch (error) {
                console.error('❌ 连接恢复检查失败:', error.message);
            }
        }, 2 * 60 * 1000); // 每2分钟检查一次

        // 启动实时状态显示任务
        setInterval(() => {
            try {
                const stats = multiManager.getStats();
                const now = new Date();
                
                // 显示实时状态
                console.log(`\n📊 [${now.toLocaleTimeString('zh-CN')}] 实时状态:`);
                console.log(`   📈 监控币种: ${stats.totalSymbols} 个`);
                console.log(`   🔗 活跃连接: ${stats.activeConnections}/${stats.maxConnections}`);
                console.log(`   ⏳ 队列长度: ${stats.queuedConnections} 个`);
                console.log(`   💾 内存使用: ${stats.memoryUsageMB} MB`);
                console.log(`   ✅ 成功连接: ${stats.successfulConnections || 0} 个`);
                console.log(`   ❌ 失败连接: ${stats.failedConnections || 0} 个`);
                console.log(`   📡 数据接收: ${stats.dataReceivedCount || 0} 条`);
                if (stats.lastDataTime) {
                    const timeSinceLastData = Date.now() - stats.lastDataTime;
                    const minutesAgo = Math.floor(timeSinceLastData / 60000);
                    console.log(`   ⏰ 最后数据: ${minutesAgo} 分钟前`);
                }
                
                // 显示一些活跃币种的实时数据
                if (stats.totalSymbols > 0) {
                    const activeSymbols = Array.from(multiManager.symbols.keys()).slice(0, 5);
                    console.log(`   🔥 活跃币种: ${activeSymbols.join(', ')}`);
                    
                    // 显示连接状态分布
                    const connectionCounts = {
                        open: 0,
                        closed: 0,
                        connecting: 0
                    };
                    
                    for (const [symbol, ws] of multiManager.connections.entries()) {
                        if (ws) {
                            switch (ws.readyState) {
                                case WebSocket.OPEN:
                                    connectionCounts.open++;
                                    break;
                                case WebSocket.CLOSED:
                                    connectionCounts.closed++;
                                    break;
                                case WebSocket.CONNECTING:
                                    connectionCounts.connecting++;
                                    break;
                            }
                        }
                    }
                    
                    console.log(`   🔌 连接状态: 开放(${connectionCounts.open}) 关闭(${connectionCounts.closed}) 连接中(${connectionCounts.connecting})`);
                }
                
                // 显示连接状态
                const connectionStatus = multiManager.getConnectionStatus();
                if (connectionStatus.brokenConnections > 0) {
                    console.log(`   ⚠️ 断开连接: ${connectionStatus.brokenConnections} 个`);
                }
                
                // 显示最近的活动
                if (stats.totalSymbols > 0) {
                    const recentActivity = [];
                    for (const [symbol, klineManager] of multiManager.symbols.entries()) {
                        if (klineManager.lastUpdateTime) {
                            const timeSinceUpdate = Date.now() - klineManager.lastUpdateTime;
                            if (timeSinceUpdate < 5 * 60 * 1000) { // 5分钟内有活动
                                recentActivity.push(symbol);
                            }
                        }
                    }
                    if (recentActivity.length > 0) {
                        console.log(`   📡 最近活动: ${recentActivity.slice(0, 3).join(', ')}${recentActivity.length > 3 ? '...' : ''}`);
                    }
                }
                
            } catch (error) {
                console.error('❌ 实时状态显示失败:', error.message);
            }
        }, 30 * 1000); // 每30秒显示一次状态
        
        // 新增：启动买入量对比监控任务 - 每5分钟执行一次
        setInterval(async () => {
            try {
                const now = new Date();
                console.log(`\n🔍 [${now.toLocaleTimeString('zh-CN')}] 开始执行买入量对比分析...`);
                
                let totalAnalyzed = 0;
                let abnormalCount = 0;
                const abnormalSymbols = [];
                
                // 遍历所有监控的币种
                for (const [symbol, klineManager] of multiManager.symbols.entries()) {
                    if (!klineManager || !klineManager.isInitialized || klineManager.klines.length < 5) {
                        continue; // 跳过未初始化或数据不足的币种
                    }
                    
                    totalAnalyzed++;
                    
                    // 获取当前K线的买入量（如果有的话）
                    let currentBuyVolume = 0;
                    if (klineManager.klines.length > 0) {
                        const latestKline = klineManager.klines[klineManager.klines.length - 1];
                        currentBuyVolume = parseFloat(latestKline.buyVolume || latestKline.volume || 0);
                    }
                    
                    // 如果当前买入量为0，跳过
                    if (currentBuyVolume <= 0) {
                        continue;
                    }
                    
                    // 分析买入量与历史均值成交量的对比
                    const comparison = klineManager.compareBuyVolumeWithAverageVolume(currentBuyVolume);
                    
                    if (comparison.percentageChange > 200) {
                        abnormalCount++;
                        abnormalSymbols.push({
                            symbol: symbol,
                            comparison: comparison
                        });
                        
                        // 构建警报消息
                        const alertMessage = `🚨 极端放量警报 - ${symbol}\n` +
                            `⏰ 时间: ${now.toLocaleString('zh-CN')}\n` +
                            `📊 当前买入量: ${comparison.currentBuyVolume.toFixed(0)}\n` +
                            `📊 历史均值成交量: ${comparison.averageVolume.toFixed(0)}\n` +
                            `📊 变化百分比: +${comparison.percentageChange.toFixed(1)}%\n` +
                            `📊 分析结果: ${comparison.comparison}\n` +
                            `📊 分析说明: ${comparison.message}\n` +
                            `📊 历史K线数量: ${comparison.historicalCount}根`;
                        
                        // 命令行输出
                        console.log(`\n${'='.repeat(80)}`);
                        console.log(alertMessage);
                        console.log(`${'='.repeat(80)}`);
                        
                        // 发送到Telegram
                        enqueueTelegramMessage(alertMessage);
                    }
                }
                
                // 输出总结信息
                console.log(`\n📊 买入量对比分析完成:`);
                console.log(`   📈 分析币种数量: ${totalAnalyzed} 个`);
                console.log(`   🚨 异常币种数量: ${abnormalCount} 个`);
                
                if (abnormalCount > 0) {
                    console.log(`   🔥 异常币种列表:`);
                    abnormalSymbols.forEach((item, index) => {
                        console.log(`      ${index + 1}. ${item.symbol}: +${item.comparison.percentageChange.toFixed(1)}%`);
                    });
                } else {
                    console.log(`   ✅ 所有币种买入量均在正常范围内`);
                }
                
                console.log(`   ⏰ 下次分析时间: ${new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString('zh-CN')}`);
                
            } catch (error) {
                console.error('❌ 买入量对比分析失败:', error.message);
            }
        }, 5 * 60 * 1000); // 每5分钟执行一次
        
        // 启动非交互式监控模式
        console.log('🔄 系统已启动，正在后台监控中...');
        console.log('💡 提示：程序将自动运行，无需人工干预');
        
    } catch (error) {
        console.error('❌ 程序启动失败:', error.message);
        console.error('错误详情:', error);
        process.exit(1);
    }
}

// 恢复币种监控的函数
async function restoreSymbolMonitoring() {
    try {
        console.log('🔄 开始恢复币种监控...');
        
        // 尝试从文件重新加载币种
        const possibleFiles = [
            path.join(__dirname, 'low_market_cap_trading_pairs.js'),
            path.join(__dirname, 'filtered_trading_pairs_by_market_cap.json'),
            path.join(__dirname, 'trading_pairs.json')
        ];
        
        let symbolsToRestore = [];
        for (const file of possibleFiles) {
            if (fs.existsSync(file)) {
                console.log(`📁 尝试从文件恢复币种: ${file}`);
                symbolsToRestore = await loadSymbolsFromFile(file);
                if (symbolsToRestore.length > 0) {
                    console.log(`✅ 成功从文件加载 ${symbolsToRestore.length} 个币种`);
                    break;
                }
            }
        }
        
        // 如果文件加载失败，使用默认币种列表
        if (symbolsToRestore.length === 0) {
            console.log('⚠️ 文件加载失败，使用默认币种列表恢复');
            symbolsToRestore = CONFIG.defaultSymbols;
        }
        
        // 限制恢复的币种数量
        const maxSymbols = 500; // 恢复时限制数量，避免过载
        if (symbolsToRestore.length > maxSymbols) {
            console.log(`⚠️ 币种数量过多 (${symbolsToRestore.length})，限制为 ${maxSymbols} 个`);
            symbolsToRestore = symbolsToRestore.slice(0, maxSymbols);
        }
        
        // 重新添加币种到监控系统
        console.log(`🔄 正在恢复 ${symbolsToRestore.length} 个币种的监控...`);
        const addedCount = await multiManager.addSymbols(symbolsToRestore);
        
        if (addedCount > 0) {
            console.log(`✅ 币种监控恢复成功！共恢复 ${addedCount} 个币种`);
            
            // 发送Telegram通知
            const message = `🔄 币种监控已自动恢复\n📊 恢复币种数量: ${addedCount} 个\n⏰ 恢复时间: ${new Date().toLocaleString('zh-CN')}`;
            enqueueTelegramMessage(message);
        } else {
            console.log('⚠️ 币种监控恢复失败');
        }
        
    } catch (error) {
        console.error('❌ 恢复币种监控失败:', error.message);
        
        // 发送错误通知
        const errorMessage = `❌ 币种监控恢复失败\n🔍 错误信息: ${error.message}\n⏰ 时间: ${new Date().toLocaleString('zh-CN')}`;
        enqueueTelegramMessage(errorMessage);
    }
}

// 程序退出处理
process.on('SIGINT', () => {
    console.log('\n👋 程序正在退出...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的Promise拒绝:', reason);
});

// 启动程序
main();

// 导出类供测试使用
module.exports = {
    KlineManager,
    MultiSymbolKlineManager,
    Semaphore,
    ConnectionRetryManager
};