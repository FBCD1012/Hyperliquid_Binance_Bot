const WebSocket = require('ws');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = 'http://127.0.0.1:7897';
const agent = new HttpsProxyAgent(proxy);

// Telegram Bot 配置
const TELEGRAM_BOT_TOKEN ='';
const TELEGRAM_CHAT_ID = '';

// 交易策略配置
const TRADING_CONFIG = {
    // 价格变化阈值：只有当价格上升超过这个百分比时才报警
    // 设置为0表示只要价格上升就报警，设置为正数表示需要上升超过该百分比
    // 例如：设置为1.0表示价格需要上升超过1%才报警
    MIN_PRICE_INCREASE_PERCENT: 0.0,
    
    // 买入量放量阈值：只有当买入量超过平均值的这个百分比时才报警
    // 例如：设置为200.0表示买入量需要超过平均值的200%才报警
    MIN_VOLUME_INCREASE_PERCENT: 200.0
};

// 连接管理配置
const CONNECTION_CONFIG = {
    // 重连策略配置
    INITIAL_RETRY_DELAY: 5000,      // 初始重连延迟（毫秒）
    MAX_RETRY_DELAY: 60000,         // 最大重连延迟（毫秒）
    RETRY_BACKOFF_MULTIPLIER: 2,    // 重连延迟倍数
    MAX_RETRY_ATTEMPTS: 10          // 最大重连尝试次数
};

// 重连延迟计算函数
function calculateRetryDelay(symbol) {
    // 从multiManager的retryQueue获取重试次数
    let retryCount = 0;
    if (multiManager && multiManager.retryQueue && multiManager.retryQueue.has(symbol)) {
        retryCount = multiManager.retryQueue.get(symbol).retryCount || 0;
    }
    
    if (retryCount >= CONNECTION_CONFIG.MAX_RETRY_ATTEMPTS) {
        // 超过最大重试次数，使用最大延迟
        return CONNECTION_CONFIG.MAX_RETRY_DELAY;
    }
    
    // 指数退避策略：延迟时间逐渐增加
    const delay = CONNECTION_CONFIG.INITIAL_RETRY_DELAY * 
                  Math.pow(CONNECTION_CONFIG.RETRY_BACKOFF_MULTIPLIER, retryCount);
    
    // 确保不超过最大延迟
    return Math.min(delay, CONNECTION_CONFIG.MAX_RETRY_DELAY);
}

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

        // 验证Chat ID格式
        if (!TELEGRAM_CHAT_ID.startsWith('-100') && !TELEGRAM_CHAT_ID.startsWith('-') && !/^\d+$/.test(TELEGRAM_CHAT_ID)) {
            console.log('⚠️ Telegram Chat ID格式无效，应该是数字或-100开头的群组ID');
            return;
        }
        
        const response = await bot.sendMessage(TELEGRAM_CHAT_ID, message, { 
            disable_web_page_preview: true
        });
        console.log('✅ Telegram消息发送成功');
    } catch (error) {
        if (error.message.includes('chat not found')) {
            console.error('❌ Telegram发送失败: Chat ID不存在或Bot无权限访问');
            console.error('💡 请检查:');
            console.error('   1. Chat ID是否正确 (当前: ' + TELEGRAM_CHAT_ID + ')');
            console.error('   2. Bot是否已添加到该群组/频道');
            console.error('   3. Bot是否有发送消息权限');
        } else if (error.message.includes('Unauthorized')) {
            console.error('❌ Telegram发送失败: Bot Token无效');
            console.error('💡 请检查Bot Token是否正确');
        } else {
            console.error('❌ Telegram发送失败:', error.message);
        }
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
    
    while (telegramQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastSend = now - lastTelegramSendTime;
        
        // 如果距离上次发送时间不足1.5秒，则等待
        if (timeSinceLastSend < TELEGRAM_RATE_LIMIT) {
            const waitTime = TELEGRAM_RATE_LIMIT - timeSinceLastSend;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        const message = telegramQueue.shift();
        
        // 检查消息去重
        const messageHash = hashMessage(message);
        const lastSentTime = messageDeduplicationCache.get(messageHash);
        
        if (lastSentTime && (now - lastSentTime < DEDUPLICATION_WINDOW)) {
            console.log('🔄 跳过重复消息（1分钟内已发送过）');
            continue;
        }
        
        try {
            await sendToTelegram(message);
            lastTelegramSendTime = Date.now();
            messageDeduplicationCache.set(messageHash, now);
            
            // 清理过期的去重缓存
            for (const [hash, timestamp] of messageDeduplicationCache.entries()) {
                if (now - timestamp > DEDUPLICATION_WINDOW) {
                    messageDeduplicationCache.delete(hash);
                }
            }
            
        } catch (error) {
            console.error('❌ 队列消息发送失败:', error.message);
            
            // 如果是429错误，等待更长时间
            if (error.message.includes('429')) {
                console.log('⏳ 遇到速率限制，等待10秒后重试...');
                telegramQueue.unshift(message);
                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                // 其他错误，等待5秒后重试
                telegramQueue.unshift(message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    
    isProcessingTelegramQueue = false;
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

// 验证Telegram配置
function validateTelegramConfig() {
    console.log('🔍 验证Telegram配置...');
    
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_bot_token_here') {
        console.log('❌ Telegram Bot Token未设置');
        return false;
    }
    
    if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'your_chat_id_here') {
        console.log('❌ Telegram Chat ID未设置');
        return false;
    }
    
    // 验证Chat ID格式
    if (!TELEGRAM_CHAT_ID.startsWith('-100') && !TELEGRAM_CHAT_ID.startsWith('-') && !/^\d+$/.test(TELEGRAM_CHAT_ID)) {
        console.log('❌ Telegram Chat ID格式无效');
        console.log('💡 群组/频道ID应该以-100开头，个人聊天ID应该是纯数字');
        return false;
    }
    
    console.log('✅ Telegram配置验证通过');
    console.log(`   Bot Token: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
    console.log(`   Chat ID: ${TELEGRAM_CHAT_ID}`);
    return true;
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

// K线数据管理器
class MultiSymbolKlineManager {
    constructor() {
        this.symbols = new Map();
        this.connections = new Map();
        this.maxConnections = 500; // 增加到500以支持大规模监控
        this.connectionQueue = []; // 连接队列
        this.isProcessingQueue = false;
        this.batchSize = 50; // 增加批处理大小，提高效率
        this.batchDelay = 1000; // 减少批次间延迟，加快处理速度
        this.maxRetries = 3; // 最大重试次数
        this.connectionTimeout = 10000; // 连接超时时间（毫秒）
        this.healthCheckInterval = 30000; // 健康检查间隔（毫秒）
        this.memoryThreshold = 0.8; // 内存使用阈值（80%）
        
        // 性能监控
        this.performanceMetrics = {
            totalConnections: 0,
            successfulConnections: 0,
            failedConnections: 0,
            avgConnectionTime: 0,
            memoryUsage: 0
        };
        
        // 启动健康检查
        this.startHealthCheck();
    }

    addSymbol(symbol) {
        if (this.symbols.has(symbol)) {
            return false; // 币种已存在
        }

        const klineManager = new KlineManager(CONFIG.historyLimit, symbol);
        this.symbols.set(symbol, klineManager);
        console.log(`📊 币种 ${symbol} 已添加到监控列表`);
        return true;
    }

    // 新增：批量添加币种
    async addSymbolsBatch(symbols, showProgress = true) {
        const totalSymbols = symbols.length;
        const batches = Math.ceil(totalSymbols / this.batchSize);
        
        if (showProgress) {
            console.log(`🔄 开始批量添加 ${totalSymbols} 个币种，分 ${batches} 批处理...`);
            console.log(`⚙️ 配置: 批大小=${this.batchSize}, 延迟=${this.batchDelay}ms, 最大连接=${this.maxConnections}`);
        }

        let successCount = 0;
        let failCount = 0;
        const startTime = Date.now();

        for (let i = 0; i < batches; i++) {
            const startIndex = i * this.batchSize;
            const endIndex = Math.min(startIndex + this.batchSize, totalSymbols);
            const batchSymbols = symbols.slice(startIndex, endIndex);

            if (showProgress) {
                console.log(`\n📦 处理第 ${i + 1}/${batches} 批 (${startIndex + 1}-${endIndex}/${totalSymbols})`);
            }

            // 检查内存使用情况
            const memoryUsage = process.memoryUsage();
            const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
            if (showProgress) {
                console.log(`💾 当前内存使用: ${memoryUsageMB}MB`);
            }

            // 如果内存使用过高，暂停处理
            if (memoryUsage.heapUsed / memoryUsage.heapTotal > this.memoryThreshold) {
                console.log(`⚠️ 内存使用过高 (${Math.round(memoryUsage.heapUsed / memoryUsage.heapTotal * 100)}%)，暂停处理...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // 并行处理当前批次的币种
            const batchPromises = batchSymbols.map(async (symbol) => {
                try {
                    // 添加到监控列表
                    if (this.addSymbol(symbol)) {
                        // 获取历史数据
                        const success = await fetchHistoricalKlines(symbol);
                        if (success) {
                            // 加入连接队列
                            this.addToConnectionQueue(symbol);
                            successCount++;
                            if (showProgress) {
                                console.log(`✅ ${symbol} 准备就绪，加入连接队列`);
                            }
                            return { symbol, success: true };
                        } else {
                            failCount++;
                            if (showProgress) {
                                console.log(`❌ ${symbol} 历史数据获取失败`);
                            }
                            return { symbol, success: false, error: '历史数据获取失败' };
                        }
                    } else {
                        failCount++;
                        if (showProgress) {
                            console.log(`❌ ${symbol} 添加失败（已存在）`);
                        }
                        return { symbol, success: false, error: '币种已存在' };
                    }
                } catch (error) {
                    failCount++;
                    if (showProgress) {
                        console.log(`❌ ${symbol} 处理出错: ${error.message}`);
                    }
                    return { symbol, success: false, error: error.message };
                }
            });

            // 等待当前批次完成
            const batchResults = await Promise.all(batchPromises);
            
            if (showProgress) {
                const batchSuccess = batchResults.filter(r => r.success).length;
                const batchFail = batchResults.filter(r => !r.success).length;
                console.log(`📊 第 ${i + 1} 批完成: 成功 ${batchSuccess} 个，失败 ${batchFail} 个`);
                
                // 显示进度
                const progress = Math.round(((i + 1) / batches) * 100);
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`📈 总体进度: ${progress}% (${elapsed}s)`);
            }

            // 批次间延迟，避免API限制
            if (i < batches - 1) {
                if (showProgress) {
                    console.log(`⏳ 等待 ${this.batchDelay/1000} 秒后处理下一批...`);
                }
                await new Promise(resolve => setTimeout(resolve, this.batchDelay));
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        if (showProgress) {
            console.log(`\n🎉 批量添加完成！`);
            console.log(`📊 结果统计: 成功 ${successCount} 个，失败 ${failCount} 个，总耗时 ${totalTime} 秒`);
            console.log(`⚡ 平均速度: ${Math.round(totalSymbols / totalTime)} 个/秒`);
        }

        return {
            total: totalSymbols,
            successCount,
            failCount,
            totalTime,
            avgSpeed: Math.round(totalSymbols / totalTime)
        };
    }

    // 新增：添加到连接队列
    addToConnectionQueue(symbol) {
        if (!this.connectionQueue.includes(symbol)) {
            this.connectionQueue.push(symbol);
            console.log(`📥 ${symbol} 已加入连接队列 (当前队列长度: ${this.connectionQueue.length})`);
            
            // 如果没有在处理队列，立即开始处理
            if (!this.isProcessingQueue) {
                console.log(`🚀 自动启动连接处理...`);
                this.processConnectionQueue();
            }
        }
    }

    // 轮询式智能连接队列处理
    async processConnectionQueue() {
        if (this.isProcessingQueue || this.connectionQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        console.log(`\n🔗 开始智能连接管理，共 ${this.connectionQueue.length} 个待连接币种...`);

        // 启动轮询检查器
        this.startConnectionPolling();

        let totalProcessed = 0;
        const startTime = Date.now();

        while (this.connectionQueue.length > 0) {
            const activeConnections = this.connections.size;
            const availableSlots = this.maxConnections - activeConnections;
            
            if (availableSlots <= 0) {
                // 智能轮询检查：主动寻找可清理的连接
                const cleanedCount = await this.pollForAvailableSlots();
                if (cleanedCount === 0) {
                    // 如果轮询没有找到可用槽位，智能等待
                    const waitTime = this.calculateSmartWaitTime();
                    console.log(`⏳ 连接池已满 (${activeConnections}/${this.maxConnections})，智能等待 ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            // 动态批处理大小：根据可用槽位和队列长度调整
            const dynamicBatchSize = Math.min(
                Math.min(10, availableSlots), // 最多10个并发
                Math.ceil(this.connectionQueue.length / 10) // 根据队列长度调整
            );
            
            const currentBatch = this.connectionQueue.splice(0, dynamicBatchSize);
            console.log(`🚀 智能批处理 ${currentBatch.length} 个连接 (可用槽位: ${availableSlots})...`);

            // 并行建立连接
            const connectionPromises = currentBatch.map(async (symbol) => {
                const connectionStartTime = Date.now();
                try {
                    await this.establishConnectionWithTimeout(symbol);
                    const connectionTime = Date.now() - connectionStartTime;
                    
                    // 更新性能指标
                    this.performanceMetrics.successfulConnections++;
                    this.performanceMetrics.avgConnectionTime = 
                        (this.performanceMetrics.avgConnectionTime * (this.performanceMetrics.successfulConnections - 1) + connectionTime) / 
                        this.performanceMetrics.successfulConnections;
                    
                    return { symbol, success: true, connectionTime };
                } catch (error) {
                    const connectionTime = Date.now() - connectionStartTime;
                    this.performanceMetrics.failedConnections++;
                    
                    console.error(`❌ ${symbol} 连接失败: ${error.message}`);
                    return { symbol, success: false, error, connectionTime };
                }
            });

            // 等待当前批次完成
            const results = await Promise.allSettled(connectionPromises);
            
            // 处理结果和重试
            results.forEach((result) => {
                if (result.status === 'fulfilled') {
                    const { symbol, success, error, connectionTime } = result.value;
                    totalProcessed++;
                    
                    if (!success) {
                        // 添加到重试队列
                        this.addToRetryQueue(symbol);
                        console.log(`🔄 ${symbol} 已加入重试队列`);
                    } else {
                        console.log(`✅ ${symbol} 连接成功 (${connectionTime}ms)`);
                    }
                }
            });

            // 显示进度
            const progress = Math.round((totalProcessed / (totalProcessed + this.connectionQueue.length)) * 100);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`📈 连接进度: ${progress}% (${totalProcessed}/${totalProcessed + this.connectionQueue.length}) - 耗时 ${elapsed}s`);

            // 智能延迟：根据连接成功率调整
            const successRate = results.filter(r => r.status === 'fulfilled' && r.value.success).length / results.length;
            const delay = successRate > 0.8 ? 100 : 500; // 成功率高时减少延迟
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        console.log(`✅ 智能连接管理完成！`);
        console.log(`📊 连接统计: 处理 ${totalProcessed} 个，耗时 ${totalTime}s，平均速度 ${Math.round(totalProcessed / totalTime)} 个/秒`);
        
        this.isProcessingQueue = false;
        this.stopConnectionPolling();
    }

    // 轮询检查可用连接槽位 - 温和释放机制
    async pollForAvailableSlots() {
        let cleanedCount = 0;
        let pollAttempts = 0;
        const maxPollAttempts = 3; // 减少轮询次数，避免过度干扰

        while (pollAttempts < maxPollAttempts) {
            pollAttempts++;
            
            // 检查连接状态
            const connectionStatus = this.analyzeConnectionStatus();
            
            if (connectionStatus.availableSlots > 0) {
                console.log(`🔍 轮询发现 ${connectionStatus.availableSlots} 个可用槽位！`);
                return cleanedCount;
            }

            // 主动清理不健康的连接（CLOSED/CLOSING状态）
            if (connectionStatus.unhealthyCount > 0) {
                console.log(`🧹 轮询清理 ${connectionStatus.unhealthyCount} 个不健康连接...`);
                cleanedCount += this.cleanupUnhealthyConnections();
                
                if (this.maxConnections - this.connections.size > 0) {
                    console.log(`✅ 轮询清理完成，释放了 ${cleanedCount} 个连接槽位`);
                    return cleanedCount;
                }
            }

            // 检查是否有连接超时（更温和的超时检测）
            if (connectionStatus.timeoutCount > 0) {
                console.log(`⏰ 轮询发现 ${connectionStatus.timeoutCount} 个超时连接...`);
                cleanedCount += this.cleanupTimeoutConnections();
                
                if (this.maxConnections - this.connections.size > 0) {
                    console.log(`✅ 轮询清理超时连接完成，释放了 ${cleanedCount} 个连接槽位`);
                    return cleanedCount;
                }
            }

            // 检查是否有僵死连接（CONNECTING状态超过30秒）
            if (connectionStatus.staleCount > 0) {
                console.log(`💀 轮询发现 ${connectionStatus.staleCount} 个僵死连接...`);
                cleanedCount += this.cleanupStaleConnections();
                
                if (this.maxConnections - this.connections.size > 0) {
                    console.log(`✅ 轮询清理僵死连接完成，释放了 ${cleanedCount} 个连接槽位`);
                    return cleanedCount;
                }
            }

            // 温和等待，避免过度干扰
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 如果轮询没有找到槽位，温和地释放少量连接
        if (cleanedCount === 0) {
            console.log(`🌱 轮询未找到槽位，温和释放少量连接...`);
            cleanedCount = this.gentleReleaseConnections();
        }
        
        return cleanedCount;
    }

    // 分析连接状态
    analyzeConnectionStatus() {
        let healthyCount = 0;
        let unhealthyCount = 0;
        let timeoutCount = 0;
        let staleCount = 0; // 新增：僵死连接计数
        const now = Date.now();

        for (const [symbol, ws] of this.connections.entries()) {
            if (ws.readyState === WebSocket.OPEN) {
                // 检查连接是否超时（超过5分钟无数据）
                if (ws.lastActivityTime && (now - ws.lastActivityTime) > 5 * 60 * 1000) {
                    timeoutCount++;
                } else {
                    healthyCount++;
                }
            } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                unhealthyCount++;
            } else {
                // WebSocket.CONNECTING 状态，可能是僵死连接
                if (ws.lastActivityTime && (now - ws.lastActivityTime) > 60 * 1000) {
                    staleCount++;
                } else {
                    unhealthyCount++;
                }
            }
        }

        return {
            healthyCount,
            unhealthyCount,
            timeoutCount,
            staleCount,
            availableSlots: this.maxConnections - this.connections.size
        };
    }

    // 清理不健康的连接
    cleanupUnhealthyConnections() {
        let cleanedCount = 0;
        
        for (const [symbol, ws] of this.connections.entries()) {
            if (ws.readyState !== WebSocket.OPEN) {
                this.cleanupConnection(symbol);
                cleanedCount++;
            }
        }
        
        return cleanedCount;
    }

    // 清理超时连接
    cleanupTimeoutConnections() {
        let cleanedCount = 0;
        const now = Date.now();
        const timeoutThreshold = 5 * 60 * 1000; // 恢复到5分钟超时，更温和

        for (const [symbol, ws] of this.connections.entries()) {
            if (ws.lastActivityTime && (now - ws.lastActivityTime) > timeoutThreshold) {
                console.log(`⏰ 清理超时连接: ${symbol} (超时: ${Math.round((now - ws.lastActivityTime) / 1000)}秒)`);
                this.cleanupConnection(symbol);
                cleanedCount++;
            }
        }
        
        return cleanedCount;
    }

    // 清理僵死连接
    cleanupStaleConnections() {
        let cleanedCount = 0;
        const now = Date.now();
        const staleThreshold = 60 * 1000; // 60秒无活动的僵死连接，更温和

        for (const [symbol, ws] of this.connections.entries()) {
            if (ws.readyState === WebSocket.CONNECTING && 
                ws.lastActivityTime && (now - ws.lastActivityTime) > staleThreshold) {
                console.log(`💀 清理僵死连接: ${symbol} (僵死: ${Math.round((now - ws.lastActivityTime) / 1000)}秒)`);
                this.cleanupConnection(symbol);
                cleanedCount++;
            }
        }
        
        return cleanedCount;
    }

    // 清理连接
    cleanupConnection(symbol) {
        const ws = this.connections.get(symbol);
        if (ws) {
            try {
                ws.close();
            } catch (e) {
                // 忽略关闭错误
            }
            this.connections.delete(symbol);
            console.log(`🧹 清理连接: ${symbol}`);
        }
    }

    // 温和释放连接 - 避免干扰TLS握手
    gentleReleaseConnections() {
        let releasedCount = 0;
        const targetReleaseCount = Math.min(5, Math.floor(this.connections.size * 0.05)); // 只释放5%的连接
        
        console.log(`🌱 开始温和释放 ${targetReleaseCount} 个连接...`);
        
        // 策略1：只释放确实有问题的连接
        const connectionsByActivity = Array.from(this.connections.entries())
            .map(([symbol, ws]) => ({
                symbol,
                ws,
                lastActivity: ws.lastActivityTime || 0,
                isHealthy: ws.readyState === WebSocket.OPEN,
                isConnecting: ws.readyState === WebSocket.CONNECTING
            }))
            .sort((a, b) => {
                // 优先释放：僵死连接 > 超时连接 > 最旧连接
                if (a.isConnecting && a.lastActivity < Date.now() - 60 * 1000) return -1;
                if (b.isConnecting && b.lastActivity < Date.now() - 60 * 1000) return 1;
                if (a.lastActivity < Date.now() - 5 * 60 * 1000) return -1;
                if (b.lastActivity < Date.now() - 5 * 60 * 1000) return 1;
                return a.lastActivity - b.lastActivity;
            });

        // 只释放确实有问题的连接，避免干扰正常连接
        for (let i = 0; i < Math.min(targetReleaseCount, connectionsByActivity.length); i++) {
            const { symbol, ws } = connectionsByActivity[i];
            
            // 只释放僵死连接或长时间无活动的连接
            const isStale = ws.readyState === WebSocket.CONNECTING && 
                           ws.lastActivityTime && (Date.now() - ws.lastActivityTime > 90 * 1000); // 90秒僵死
            const isTimeout = ws.lastActivityTime && (Date.now() - ws.lastActivityTime > 8 * 60 * 1000); // 8分钟超时
            
            if (isStale || isTimeout) {
                try {
                    ws.close();
                    this.connections.delete(symbol);
                    releasedCount++;
                    console.log(`🌱 温和释放连接: ${symbol} (${isStale ? '僵死' : '超时'})`);
                } catch (e) {
                    console.error(`❌ 温和释放连接失败: ${symbol}`, e.message);
                }
            }
        }

        console.log(`✅ 温和释放完成，共释放 ${releasedCount} 个连接`);
        return releasedCount;
    }

    // 带超时的连接建立
    async establishConnectionWithTimeout(symbol) {
        return new Promise((resolve, reject) => {
            try {
                const ws = connectWebSocketForSymbol(symbol);
                
                // 设置连接超时
                const connectionTimeout = setTimeout(() => {
                    reject(new Error('连接超时'));
                }, 8000);

                ws.once('open', () => {
                    clearTimeout(connectionTimeout);
                    console.log(`🔗 ${symbol} 连接建立成功 (${this.connections.size}/${this.maxConnections})`);
                    resolve();
                });

                ws.once('error', (error) => {
                    clearTimeout(connectionTimeout);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    // 计算智能等待时间
    calculateSmartWaitTime() {
        const queueLength = this.connectionQueue.length;
        const activeConnections = this.connections.size;
        
        // 根据队列长度动态调整等待时间
        if (queueLength > 200) return 300; // 队列很长，快速重试
        if (queueLength > 100) return 500; // 队列中等，中等速度
        if (activeConnections > this.maxConnections * 0.95) return 2000; // 接近满负荷，等待更久
        return 1000; // 默认等待时间
    }

    // 重试队列管理
    retryQueue = new Map(); // symbol -> { retryCount, nextRetryTime }

    addToRetryQueue(symbol) {
        const retryInfo = this.retryQueue.get(symbol) || { retryCount: 0 };
        retryInfo.retryCount++;
        
        if (retryInfo.retryCount <= 3) {
            const delay = Math.min(3000 * Math.pow(2, retryInfo.retryCount - 1), 15000);
            retryInfo.nextRetryTime = Date.now() + delay;
            
            this.retryQueue.set(symbol, retryInfo);
            
            setTimeout(() => {
                if (this.retryQueue.has(symbol)) {
                    this.retryQueue.delete(symbol);
                    this.connectionQueue.unshift(symbol); // 优先处理重试的币种
                    console.log(`🔄 ${symbol} 重试连接...`);
                }
            }, delay);
        } else {
            console.log(`⚠️ ${symbol} 重试次数过多，暂时跳过`);
        }
    }

    // 轮询器管理
    connectionPollingInterval = null;

    startConnectionPolling() {
        if (this.connectionPollingInterval) return;
        
        this.connectionPollingInterval = setInterval(() => {
            if (this.connectionQueue.length > 0 && !this.isProcessingQueue) {
                console.log(`🔍 轮询器触发：队列中有 ${this.connectionQueue.length} 个币种等待连接`);
                this.processConnectionQueue();
            }
        }, 5000); // 每5秒检查一次，减少频率
        
        console.log(`🔄 启动连接轮询器，每5秒检查一次`);
    }

    stopConnectionPolling() {
        if (this.connectionPollingInterval) {
            clearInterval(this.connectionPollingInterval);
            this.connectionPollingInterval = null;
            console.log(`🛑 停止连接轮询器`);
        }
    }

    // 新增：获取系统状态
    getSystemStatus() {
        const activeConnections = this.connections.size;
        const queueLength = this.connectionQueue.length;
        const totalSymbols = this.symbols.size;
        
        // 估算内存使用（每个币种约0.5MB）
        const estimatedMemory = Math.round(totalSymbols * 0.5);
        
        return {
            totalSymbols,
            activeConnections,
            maxConnections: this.maxConnections,
            queueLength,
            estimatedMemory: `${estimatedMemory}MB`,
            isProcessingQueue: this.isProcessingQueue
        };
    }

    // 新增：显示系统状态
    showSystemStatus() {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
        const memoryUsagePercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);
        
        const performanceMetrics = this.getPerformanceMetrics();
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 系统状态报告');
        console.log('='.repeat(80));
        console.log(`🪙 监控币种: ${this.symbols.size} 个`);
        console.log(`🔗 活跃连接: ${this.connections.size}/${this.maxConnections} (${Math.round((this.connections.size / this.maxConnections) * 100)}%)`);
        console.log(`⏳ 连接队列: ${this.connectionQueue.length} 个待处理`);
        console.log(`🔄 重试队列: ${this.retryQueue.size} 个待重试`);
        console.log('');
        console.log(`💾 内存使用: ${heapUsedMB}MB/${heapTotalMB}MB (${memoryUsagePercent}%)`);
        console.log(`⚡ 连接性能: 成功 ${performanceMetrics.successfulConnections} 个，失败 ${performanceMetrics.failedConnections} 个`);
        console.log(`⏱️ 平均连接时间: ${Math.round(performanceMetrics.avgConnectionTime)}ms`);
        console.log('');
        
        // 连接状态分布
        let openConnections = 0;
        let connectingConnections = 0;
        let closingConnections = 0;
        let closedConnections = 0;
        
        for (const [symbol, ws] of this.connections) {
            switch (ws.readyState) {
                case 0: connectingConnections++; break; // CONNECTING
                case 1: openConnections++; break;       // OPEN
                case 2: closingConnections++; break;    // CLOSING
                case 3: closedConnections++; break;     // CLOSED
            }
        }
        
        console.log(`🔌 连接状态分布:`);
        console.log(`   📡 连接中: ${connectingConnections} 个`);
        console.log(`   ✅ 已连接: ${openConnections} 个`);
        console.log(`   🔄 关闭中: ${closingConnections} 个`);
        console.log(`   ❌ 已关闭: ${closedConnections} 个`);
        
        // 500连接支持状态
        if (this.maxConnections >= 500) {
            console.log('');
            console.log(`🚀 大规模连接支持 (${this.maxConnections} 连接):`);
            console.log(`   📦 批处理大小: ${this.batchSize} 个/批`);
            console.log(`   ⏱️ 批次延迟: ${this.batchDelay}ms`);
            console.log(`   🏥 健康检查: ${this.healthCheckInterval/1000}s 间隔`);
            console.log(`   🧠 内存阈值: ${this.memoryThreshold * 100}%`);
        }
        
        console.log('='.repeat(80));
    }

    // 新增：定期清理过期数据
    startCleanupTask() {
        // 每5分钟清理一次过期数据
        setInterval(() => {
            this.cleanupExpiredData();
        }, 5 * 60 * 1000);
    }

    // 新增：清理过期数据
    cleanupExpiredData() {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5分钟无活动清理
        const maxSymbols = 1000; // 最大监控币种数
        
        let cleanedCount = 0;
        
        // 清理长时间无活动的币种
        for (const [symbol, klineManager] of this.symbols.entries()) {
            if (now - klineManager.lastUpdateTime > inactiveThreshold) {
                this.removeSymbol(symbol);
                cleanedCount++;
            }
        }
        
        // 如果币种数量超过限制，清理最旧的
        if (this.symbols.size > maxSymbols) {
            const symbolsToRemove = this.symbols.size - maxSymbols;
            const sortedSymbols = Array.from(this.symbols.entries())
                .sort((a, b) => a[1].lastUpdateTime - b[1].lastUpdateTime)
                .slice(0, symbolsToRemove);
            
            sortedSymbols.forEach(([symbol]) => {
                this.removeSymbol(symbol);
                cleanedCount++;
            });
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 清理完成: 移除了 ${cleanedCount} 个无活动币种`);
            // 强制垃圾回收
            if (global.gc) {
                global.gc();
                console.log('♻️ 触发垃圾回收');
            }
        }
    }

    removeSymbol(symbol) {
        // 关闭WebSocket连接
        const connection = this.connections.get(symbol);
        if (connection) {
            connection.close();
            this.connections.delete(symbol);
        }

        // 从队列中移除
        const queueIndex = this.connectionQueue.indexOf(symbol);
        if (queueIndex > -1) {
            this.connectionQueue.splice(queueIndex, 1);
        }

        // 移除K线管理器
        this.symbols.delete(symbol);
        console.log(`🗑️ 币种 ${symbol} 已从监控列表中移除`);
    }

    getSymbols() {
        return Array.from(this.symbols.keys());
    }

    getKlineManager(symbol) {
        return this.symbols.get(symbol);
    }

    setConnection(symbol, ws) {
        this.connections.set(symbol, ws);
    }

    getConnection(symbol) {
        return this.connections.get(symbol);
    }

    // 启动健康检查
    startHealthCheck() {
        if (this.healthCheckInterval) {
            setInterval(() => {
                this.performHealthCheck();
            }, this.healthCheckInterval);
        }
    }

    // 执行健康检查
    performHealthCheck() {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
        const memoryUsagePercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);

        this.performanceMetrics.memoryUsage = memoryUsagePercent;

        // 检查连接健康状态
        let healthyConnections = 0;
        let unhealthyConnections = 0;
        let totalConnections = this.connections.size;

        for (const [symbol, ws] of this.connections) {
            if (ws.readyState === 1) { // OPEN状态
                healthyConnections++;
            } else {
                unhealthyConnections++;
            }
        }

        // 如果内存使用过高，触发垃圾回收
        if (memoryUsagePercent > 85) {
            console.log(`⚠️ 内存使用过高 (${memoryUsagePercent}%)，触发垃圾回收...`);
            if (global.gc) {
                global.gc();
                console.log(`🧹 垃圾回收完成`);
            }
        }

        // 如果连接池使用率过高，考虑清理
        const connectionUsagePercent = Math.round((totalConnections / this.maxConnections) * 100);
        if (connectionUsagePercent > 90) {
            console.log(`⚠️ 连接池使用率过高 (${connectionUsagePercent}%)，考虑清理...`);
            this.cleanupUnhealthyConnections();
        }

        // 记录健康状态
        console.log(`🏥 健康检查: 内存 ${heapUsedMB}MB/${heapTotalMB}MB (${memoryUsagePercent}%) | 连接 ${healthyConnections}/${totalConnections} (${connectionUsagePercent}%)`);
    }

    // 获取性能指标
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            connectionPoolUsage: Math.round((this.connections.size / this.maxConnections) * 100),
            queueLength: this.connectionQueue.length,
            activeConnections: this.connections.size
        };
    }
}

// 单个币种的K线管理器
class KlineManager {
    constructor(maxLength = 30, symbol = '') {
        this.maxLength = maxLength;
        this.symbol = symbol;
        this.klines = [];
        this.buyVolumes = []; // 新增：存储买入量数据
        this.isInitialized = false;
        this.lastUpdateTime = 0;
    }

    addKline(klineData) {
        // 检查是否已经存在相同时间戳的K线，防止重复添加
        if (this.klines.length > 0) {
            const lastKline = this.klines[this.klines.length - 1];
            if (lastKline.closeTime === klineData.closeTime) {
                // 如果时间戳相同，更新现有K线数据而不是添加新的
                lastKline.open = klineData.open;
                lastKline.high = klineData.high;
                lastKline.low = klineData.low;
                lastKline.close = klineData.close;
                lastKline.volume = klineData.volume;
                lastKline.quoteVolume = klineData.quoteVolume;
                lastKline.trades = klineData.trades;
                lastKline.isCompleted = klineData.isCompleted;
                lastKline.buyVolume = klineData.buyVolume;
                lastKline.buyQuoteVolume = klineData.buyQuoteVolume;
                
                // 更新买入量数据
                if (this.buyVolumes.length > 0) {
                    this.buyVolumes[this.buyVolumes.length - 1] = klineData.buyVolume || klineData.volume;
                }
                
                this.lastUpdateTime = Date.now();
                return; // 不添加新K线，直接返回
            }
        }
        
        // 添加新的K线数据
        this.klines.push(klineData);
        
        // 添加买入量数据（如果有的话）
        if (klineData.buyVolume !== undefined) {
            this.buyVolumes.push(klineData.buyVolume);
        } else if (klineData.volume !== undefined) {
            // 如果没有买入量数据，使用总成交量作为备选
            this.buyVolumes.push(klineData.volume);
        }
        
        // 限制数组长度
        if (this.klines.length > this.maxLength) {
            this.klines.shift();
        }
        if (this.buyVolumes.length > this.maxLength) {
            this.buyVolumes.shift();
        }
        
        // 标记为已初始化
        if (this.klines.length >= 5) {
            this.isInitialized = true;
        }
        
        this.lastUpdateTime = Date.now();
    }

    // 计算平均买入量
    calculateAverageBuyVolume() {
        if (this.buyVolumes.length === 0) return 0;
        
        const sum = this.buyVolumes.reduce((acc, volume) => acc + volume, 0);
        return sum / this.buyVolumes.length;
    }

    // 获取买入量统计信息
    getBuyVolumeStats() {
        if (this.buyVolumes.length === 0) {
            return {
                currentBuyVolume: 0,
                averageBuyVolume: 0,
                historicalCount: 0,
                buyVolumeHistory: []
            };
        }

        const currentBuyVolume = this.buyVolumes[this.buyVolumes.length - 1];
        const averageBuyVolume = this.calculateAverageBuyVolume();
        
        return {
            currentBuyVolume,
            averageBuyVolume,
            historicalCount: this.buyVolumes.length,
            buyVolumeHistory: [...this.buyVolumes]
        };
    }

    // 分析买入量变化 - 只检测放量
    analyzeBuyVolume(currentBuyVolume) {
        if (this.buyVolumes.length < 5) {
            return null; // 数据不足
        }

        const averageBuyVolume = this.calculateAverageBuyVolume();
        const percentageChange = ((currentBuyVolume - averageBuyVolume) / averageBuyVolume) * 100;
        
        // 只检测放量，不检测缩量
        if (percentageChange <= 0) {
            return null; // 不是放量，返回null
        }
        
        // 只检测放量大于配置阈值的情况
        if (percentageChange <= TRADING_CONFIG.MIN_VOLUME_INCREASE_PERCENT) {
            return null; // 放量程度不够，返回null
        }
        
        // 确定买入量放量等级
        let buyVolumeLevel = '🔥 极度放量';
        if (percentageChange > 500) buyVolumeLevel = '🚨 超级放量';
        else if (percentageChange > 300) buyVolumeLevel = '🔥 极度放量';
        else if (percentageChange > 200) buyVolumeLevel = '📈 大幅放量';
        
        return {
            currentBuyVolume,
            averageBuyVolume,
            percentageChange,
            buyVolumeLevel,
            historicalCount: this.buyVolumes.length,
            isAbnormal: percentageChange > 200 // 只有超过200%才算异常
        };
    }

    // 新增：检测两根K线（15分钟周期）内的放量情况，并检查价格变化
    analyzeTwoKlineVolume() {
        if (this.klines.length < 2) {
            return null; // 至少需要2根K线
        }

        // 获取最近两根K线，确保它们是不同的K线
        const recentKlines = this.klines.slice(-2);
        const firstKline = recentKlines[0];
        const secondKline = recentKlines[1];
        
        // 验证两根K线是否真的不同（通过时间戳判断）
        if (firstKline.closeTime === secondKline.closeTime) {
            return null; // 同一根K线，返回null
        }
        
        // 验证K线时间间隔是否正确（5分钟间隔）
        const timeDiff = Math.abs(secondKline.closeTime - firstKline.closeTime);
        const expectedInterval = 5 * 60 * 1000; // 5分钟 = 300000毫秒
        const tolerance = 10 * 1000; // 允许10秒的误差
        
        if (Math.abs(timeDiff - expectedInterval) > tolerance) {
            return null; // 时间间隔不正确，可能不是连续的K线
        }
        
        // 计算价格变化
        const firstClosePrice = parseFloat(firstKline.close);
        const secondClosePrice = parseFloat(secondKline.close);
        const priceChange = secondClosePrice - firstClosePrice;
        const priceChangePercentage = (priceChange / firstClosePrice) * 100;
        
        // 只检测价格上升的情况，价格下降时返回null
        // 这样可以避免在价格下跌时误报，只关注真正的上涨趋势
        if (priceChange <= 0) {
            return null; // 价格没有上升，返回null
        }
        
        // 检查价格上升是否超过配置的阈值
        if (priceChangePercentage < TRADING_CONFIG.MIN_PRICE_INCREASE_PERCENT) {
            return null; // 价格上升幅度不够，返回null
        }
        
        // 计算第一根K线的放量情况
        const firstAnalysis = this.analyzeBuyVolume(firstKline.buyVolume);
        // 计算第二根K线的放量情况
        const secondAnalysis = this.analyzeBuyVolume(secondKline.buyVolume);
        
        // 如果两根K线都没有放量，返回null
        if (!firstAnalysis && !secondAnalysis) {
            return null;
        }
        
        // 如果只有一根K线放量，返回null（不满足两根K线的要求）
        if (!firstAnalysis || !secondAnalysis) {
            return null;
        }
        
        // 两根K线都放量，计算综合指标
        const totalBuyVolume = firstKline.buyVolume + secondKline.buyVolume;
        const totalAverageBuyVolume = (firstAnalysis.averageBuyVolume + secondAnalysis.averageBuyVolume) / 2;
        const totalPercentageChange = ((totalBuyVolume - totalAverageBuyVolume) / totalAverageBuyVolume) * 100;
        
        // 确定综合放量等级
        let combinedBuyVolumeLevel = '🔥 极度放量';
        if (totalPercentageChange > 500) combinedBuyVolumeLevel = '🚨 超级放量';
        else if (totalPercentageChange > 300) combinedBuyVolumeLevel = '🔥 极度放量';
        else if (totalPercentageChange > TRADING_CONFIG.MIN_VOLUME_INCREASE_PERCENT) combinedBuyVolumeLevel = '📈 大幅放量';
        
        return {
            firstKline: {
                time: firstKline.closeTime,
                buyVolume: firstKline.buyVolume,
                percentageChange: firstAnalysis.percentageChange,
                buyVolumeLevel: firstAnalysis.buyVolumeLevel,
                closePrice: firstClosePrice
            },
            secondKline: {
                time: secondKline.closeTime,
                buyVolume: secondKline.buyVolume,
                percentageChange: secondAnalysis.percentageChange,
                buyVolumeLevel: secondAnalysis.buyVolumeLevel,
                closePrice: secondClosePrice
            },
            priceChange: {
                absolute: priceChange,
                percentage: priceChangePercentage,
                isUp: true
            },
            combined: {
                totalBuyVolume,
                totalAverageBuyVolume,
                totalPercentageChange,
                buyVolumeLevel: combinedBuyVolumeLevel,
                isAbnormal: totalPercentageChange > TRADING_CONFIG.MIN_VOLUME_INCREASE_PERCENT
            },
            historicalCount: this.buyVolumes.length,
            // 添加验证信息
            validation: {
                timeDiff: timeDiff,
                expectedInterval: expectedInterval,
                isValidInterval: Math.abs(timeDiff - expectedInterval) <= tolerance,
                firstKlineTime: new Date(firstKline.closeTime).toISOString(),
                secondKlineTime: new Date(secondKline.closeTime).toISOString()
            }
        };
    }

    // 获取状态摘要
    getStatusSummary() {
        const stats = this.getBuyVolumeStats();
        return {
            symbol: this.symbol,
            klineCount: this.klines.length,
            buyVolumeCount: this.buyVolumes.length,
            currentBuyVolume: stats.currentBuyVolume,
            averageBuyVolume: stats.averageBuyVolume,
            lastUpdate: this.lastUpdateTime,
            isInitialized: this.isInitialized
        };
    }
}

// 创建多币种管理器实例
const multiManager = new MultiSymbolKlineManager();

// 获取单个币种的历史K线数据
async function fetchHistoricalKlines(symbol) {
    try {
        console.log(`📊 获取 ${symbol} 历史数据...`);
        
        const response = await axiosInstance.get(CONFIG.apiUrl, {
            params: {
                symbol: symbol,
                interval: CONFIG.interval,
                limit: CONFIG.historyLimit
            },
            timeout: 10000
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
            trades: parseInt(kline[8]),
            buyVolume: parseFloat(kline[9]), // 新增：买入量
            buyQuoteVolume: parseFloat(kline[10]) // 新增：买入成交额
        }));

        const klineManager = multiManager.getKlineManager(symbol);
        if (klineManager) {
            historicalKlines.forEach(kline => {
                klineManager.addKline(kline);
            });
            klineManager.isInitialized = true;

            const stats = klineManager.getBuyVolumeStats();
            console.log(`✅ ${symbol} 数据加载完成 - 平均买入量: ${stats.averageBuyVolume.toFixed(2)}`);
        }

        return true;
    } catch (error) {
        console.error(`❌ ${symbol} 历史数据获取失败:`, error.message);
        return false;
    }
}

// 为单个币种建立WebSocket连接
function connectWebSocketForSymbol(symbol) {
    const wsUrl = `${CONFIG.wsBaseUrl}${symbol.toLowerCase()}@kline_${CONFIG.interval}`;
    
    // 增强的WebSocket连接选项
    const wsOptions = {
        agent: agent,
        handshakeTimeout: 30000, // 增加握手超时时间到30秒
        maxPayload: 1024 * 1024, // 1MB最大负载
        perMessageDeflate: false, // 禁用消息压缩以提高性能
        followRedirects: true, // 允许重定向
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Multi-Symbol Volume Monitor)',
            'Accept-Encoding': 'gzip, deflate',
            'Cache-Control': 'no-cache'
        }
    };
    
    const ws = new WebSocket(wsUrl, wsOptions);

    ws.on('open', () => {
        console.log(`🔗 ${symbol} WebSocket连接成功`);
    });

    ws.on('message', (data) => {
        // 更新连接活动时间
        ws.lastActivityTime = Date.now();
        
        try {
            const message = JSON.parse(data);
            const klineData = message.k;

            if (klineData) {
                // 构建K线对象，包含买入量数据
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
                const klineManager = multiManager.getKlineManager(symbol);
                if (klineManager && klineManager.isInitialized) {
                    // 添加或更新K线数据
                    klineManager.addKline(currentKline);
                    
                    // 只有在K线真正完成时才进行详细分析
                    if (klineData.x) {
                        // 添加延迟，确保K线数据完全更新
                        setTimeout(() => {
                            handleCompletedKline(symbol, currentKline);
                        }, 1000); // 延迟1秒，确保数据完整性
                    }
                    // 如果是进行中的K线，进行简单监控（每30秒显示一次）
                    else {
                        handleOngoingKline(symbol, currentKline);
                    }
                }
            }
        } catch (error) {
            console.error(`❌ ${symbol} 消息处理失败:`, error.message);
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ ${symbol} WebSocket错误:`, error.message);
        
        // 根据错误类型提供具体的解决建议
        if (error.message.includes('TLS connection')) {
            console.log(`💡 ${symbol} TLS连接问题，可能原因：`);
            console.log(`   - 网络连接不稳定`);
            console.log(`   - 代理配置问题`);
            console.log(`   - 防火墙限制`);
        } else if (error.message.includes('ECONNREFUSED')) {
            console.log(`💡 ${symbol} 连接被拒绝，可能原因：`);
            console.log(`   - 网络端口被阻止`);
            console.log(`   - 代理服务器问题`);
        } else if (error.message.includes('ETIMEDOUT')) {
            console.log(`💡 ${symbol} 连接超时，可能原因：`);
            console.log(`   - 网络延迟过高`);
            console.log(`   - 服务器响应慢`);
        }
        
        // 智能重连策略
        const retryDelay = calculateRetryDelay(symbol);
        setTimeout(() => {
            console.log(`🔄 ${symbol} ${retryDelay/1000}秒后尝试重连...`);
            connectWebSocketForSymbol(symbol);
        }, retryDelay);
    });

    ws.on('close', (code, reason) => {
        console.log(`⚠️ ${symbol} WebSocket连接断开 - 代码: ${code}, 原因: ${reason}`);
        
        // 根据关闭代码提供建议
        if (code === 1006) {
            console.log(`💡 ${symbol} 异常断开，可能是网络问题`);
        } else if (code === 1015) {
            console.log(`💡 ${symbol} TLS握手失败，检查网络环境`);
        }
        
        // 智能重连策略
        const retryDelay = calculateRetryDelay(symbol);
        setTimeout(() => {
            console.log(`🔄 ${symbol} ${retryDelay/1000}秒后尝试重连...`);
            connectWebSocketForSymbol(symbol);
        }, retryDelay);
    });

    multiManager.setConnection(symbol, ws);
    return ws;
}

// 处理完成的K线数据 - 只检测买入量放量
async function handleCompletedKline(symbol, klineData) {
    const klineManager = multiManager.getKlineManager(symbol);
    if (!klineManager || !klineManager.isInitialized) {
        return;
    }

    // 使用新的两根K线检测逻辑
    const twoKlineAnalysis = klineManager.analyzeTwoKlineVolume();
    
    // 如果没有检测到两根K线都放量，直接返回
    if (!twoKlineAnalysis) {
        return;
    }
    
    // 添加调试日志，验证两根K线信息
    console.log(`\n🔍 ${symbol} 两根K线验证信息:`);
    console.log(`   📅 第一根K线: ${new Date(twoKlineAnalysis.validation.firstKlineTime).toLocaleString('zh-CN')}`);
    console.log(`   📅 第二根K线: ${new Date(twoKlineAnalysis.validation.secondKlineTime).toLocaleString('zh-CN')}`);
    console.log(`   ⏱️  时间间隔: ${twoKlineAnalysis.validation.timeDiff}ms (期望: ${twoKlineAnalysis.validation.expectedInterval}ms)`);
    console.log(`   ✅ 间隔验证: ${twoKlineAnalysis.validation.isValidInterval ? '通过' : '失败'}`);
    
    const firstTimeStr = new Date(twoKlineAnalysis.firstKline.time).toLocaleString('zh-CN');
    const secondTimeStr = new Date(twoKlineAnalysis.secondKline.time).toLocaleString('zh-CN');
    
    // 检查是否为异常放量（大于200%）
    const isAbnormal = twoKlineAnalysis.combined.isAbnormal;
    
    if (isAbnormal) {
        // 异常放量：获取详细信息并整合显示
        const tokenDetails = await getCachedTokenDetails(symbol);
        
        // 控制台输出
        console.log(`\n🚨 ====== ${symbol} 两根K线买入量放量警报 ======`);
        console.log(`⏰ 第一根K线时间: ${firstTimeStr}`);
        console.log(`📊 第一根K线买入量: ${twoKlineAnalysis.firstKline.buyVolume.toFixed(0)} | 放量程度: +${twoKlineAnalysis.firstKline.percentageChange.toFixed(1)}% | 评级: ${twoKlineAnalysis.firstKline.buyVolumeLevel}`);
        console.log(`💰 第一根K线收盘价: ${twoKlineAnalysis.firstKline.closePrice.toFixed(6)}`);
        console.log(`⏰ 第二根K线时间: ${secondTimeStr}`);
        console.log(`📊 第二根K线买入量: ${twoKlineAnalysis.secondKline.buyVolume.toFixed(0)} | 放量程度: +${twoKlineAnalysis.secondKline.percentageChange.toFixed(1)}% | 评级: ${twoKlineAnalysis.secondKline.buyVolumeLevel}`);
        console.log(`💰 第二根K线收盘价: ${twoKlineAnalysis.secondKline.closePrice.toFixed(6)}`);
        console.log(`\n📈 价格变化:`);
        console.log(`📈 价格变化: +${twoKlineAnalysis.priceChange.absolute.toFixed(6)} (+${twoKlineAnalysis.priceChange.percentage.toFixed(2)}%)`);
        console.log(`\n📊 综合指标:`);
        console.log(`📊 总买入量: ${twoKlineAnalysis.combined.totalBuyVolume.toFixed(0)} | 30根均值: ${twoKlineAnalysis.combined.totalAverageBuyVolume.toFixed(0)}`);
        console.log(`📊 综合放量程度: +${twoKlineAnalysis.combined.totalPercentageChange.toFixed(1)}% | 综合评级: ${twoKlineAnalysis.combined.buyVolumeLevel}`);
        console.log(`📊 历史数据: ${twoKlineAnalysis.historicalCount}根K线`);
        
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
        
        console.log(`🔥 警报: ${symbol} 两根K线连续买入量异常放量！`);
        console.log(`📈 价格上升: +${twoKlineAnalysis.priceChange.percentage.toFixed(2)}%`);
        console.log(`==========================================`);
        
        // 构建Telegram消息
        let telegramMessage = `🚨 ${symbol} 两根K线买入量放量警报\n\n`;
        telegramMessage += `⏰ 第一根K线: ${firstTimeStr}\n`;
        telegramMessage += `📊 买入量: ${twoKlineAnalysis.firstKline.buyVolume.toFixed(0)} | 放量: +${twoKlineAnalysis.firstKline.percentageChange.toFixed(1)}% | 评级: ${twoKlineAnalysis.firstKline.buyVolumeLevel}\n`;
        telegramMessage += `💰 收盘价: ${twoKlineAnalysis.firstKline.closePrice.toFixed(6)}\n`;
        telegramMessage += `⏰ 第二根K线: ${secondTimeStr}\n`;
        telegramMessage += `📊 买入量: ${twoKlineAnalysis.secondKline.buyVolume.toFixed(0)} | 放量: +${twoKlineAnalysis.secondKline.percentageChange.toFixed(1)}% | 评级: ${twoKlineAnalysis.secondKline.buyVolumeLevel}\n`;
        telegramMessage += `💰 收盘价: ${twoKlineAnalysis.secondKline.closePrice.toFixed(6)}\n\n`;
        telegramMessage += `📈 价格变化: +${twoKlineAnalysis.priceChange.absolute.toFixed(6)} (+${twoKlineAnalysis.priceChange.percentage.toFixed(2)}%)\n\n`;
        telegramMessage += `📊 综合指标:\n`;
        telegramMessage += `📊 总买入量: ${twoKlineAnalysis.combined.totalBuyVolume.toFixed(0)} | 30根均值: ${twoKlineAnalysis.combined.totalAverageBuyVolume.toFixed(0)}\n`;
        telegramMessage += `📊 综合放量程度: +${twoKlineAnalysis.combined.totalPercentageChange.toFixed(1)}% | 综合评级: ${twoKlineAnalysis.combined.buyVolumeLevel}\n`;
        telegramMessage += `📊 历史数据: ${twoKlineAnalysis.historicalCount}根K线\n\n`;
        
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
        
        telegramMessage += `🔥 警报: ${symbol} 两根K线连续买入量异常放量！`;
        telegramMessage += `\n📈 价格上升: +${twoKlineAnalysis.priceChange.percentage.toFixed(2)}%`;
        
        // 发送到Telegram
        enqueueTelegramMessage(telegramMessage);
    }
    // 注意：现在只处理两根K线都放量且综合放量大于200%的情况
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

    const currentBuyVolume = parseFloat(klineData.buyVolume || klineData.volume);
    const analysis = klineManager.analyzeBuyVolume(currentBuyVolume);

    if (analysis && analysis.historicalCount >= 5) {
        const timeStr = new Date(klineData.closeTime).toLocaleString('zh-CN');
        const priceChange = klineData.close > klineData.open ? '📈' : '📉';
        const priceChangePercent = ((klineData.close - klineData.open) / klineData.open * 100).toFixed(2);

        console.log(`📊 ${symbol} 进行中 | ${timeStr} | 价格: ${klineData.close} (${priceChange}${priceChangePercent}%) | 买入量: ${analysis.buyVolumeLevel} (${analysis.percentageChange.toFixed(1)}%)`);
    }
}

// 主程序
async function main() {
    console.log('🚀 启动多币种K线买入量监控程序...\n');
    
    // 尝试自动加载500个币种
    let symbolsToMonitor = [];
    
    // 1. 尝试从low_market_cap_trading_pairs.js加载
    try {
        const fs = require('fs');
        const path = require('path');
        
        const possibleFiles = [
            'low_market_cap_trading_pairs.js',
            'filtered_trading_pairs_by_market_cap.json',
            'trading_pairs.json'
        ];
        
        let foundFile = null;
        for (const file of possibleFiles) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                foundFile = file;
                console.log(`📁 自动发现币种文件: ${file}`);
                break;
            }
        }
        
        if (foundFile) {
            const filePath = path.join(__dirname, foundFile);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            
            if (foundFile.endsWith('.js')) {
                // JavaScript数组格式
                const match = fileContent.match(/const\s+\w+\s*=\s*\[([\s\S]*?)\];/);
                if (match) {
                    const arrayContent = match[1];
                    symbolsToMonitor = arrayContent
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.startsWith("'") && line.endsWith("',"))
                        .map(line => line.slice(1, -2));
                }
            } else if (foundFile.endsWith('.json')) {
                // JSON格式
                try {
                    const data = JSON.parse(fileContent);
                    if (Array.isArray(data)) {
                        symbolsToMonitor = data;
                    } else if (data.symbols && Array.isArray(data.symbols)) {
                        symbolsToMonitor = data.symbols;
                    } else if (data.filteredTradingPairs && Array.isArray(data.filteredTradingPairs)) {
                        symbolsToMonitor = data.filteredTradingPairs.map(item => item.tradingPair);
                    }
                } catch (e) {
                    console.error('❌ JSON解析失败:', e.message);
                }
            }
            
            console.log(`✅ 成功加载 ${symbolsToMonitor.length} 个币种`);
        }
    } catch (error) {
        console.log(`⚠️ 自动加载币种文件失败: ${error.message}`);
    }
    
    // 2. 如果没有找到文件，使用默认币种列表
    if (symbolsToMonitor.length === 0) {
        console.log('⚠️ 未能从文件加载币种，使用默认币种列表');
        symbolsToMonitor = CONFIG.defaultSymbols;
    }
    
    // 3. 显示币种信息
    console.log(`🎯 准备监控 ${symbolsToMonitor.length} 个币种\n`);
    
    // 4. 使用批量添加机制
    try {
        const result = await multiManager.addSymbolsBatch(symbolsToMonitor);
        
        console.log(`\n🎉 币种添加完成！`);
        console.log(`📊 系统状态: 监控${result.total}个币种 | 成功${result.successCount}个 | 失败${result.failCount}个`);
        
        // 显示系统状态
        multiManager.showSystemStatus();
        
        // 启动定期状态显示
        setInterval(() => {
            multiManager.showSystemStatus();
        }, 30000); // 每30秒显示一次状态
        
        // 启动定期清理任务
        multiManager.startCleanupTask();
        
    } catch (error) {
        console.error(`❌ 批量添加币种失败: ${error.message}`);
        console.log('🔄 尝试使用传统方式添加默认币种...');
        
        // 回退到传统方式
        for (const symbol of CONFIG.defaultSymbols.slice(0, 10)) { // 只添加前10个作为测试
            console.log(`📊 正在添加默认监控币种 ${symbol}...`);
            if (multiManager.addSymbol(symbol)) {
                try {
                    const success = await fetchHistoricalKlines(symbol);
                    if (success) {
                        connectWebSocketForSymbol(symbol);
                        console.log(`✅ ${symbol} 监控启动成功！`);
                    } else {
                        console.log(`❌ ${symbol} 添加失败`);
                    }
                } catch (error) {
                    console.log(`❌ ${symbol} 添加过程中出错: ${error.message}`);
                }
            }
            console.log(''); // 添加空行分隔
        }
    }
    
    console.log('\n📊 程序正在运行中，监控所有币种的买入量变化...');
    console.log('💡 如需停止程序，请按 Ctrl+C\n');
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