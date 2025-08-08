const WebSocket = require('ws');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');

const proxy = 'http://127.0.0.1:7897';
const agent = new HttpsProxyAgent(proxy);

// Telegram Bot 配置
const TELEGRAM_BOT_TOKEN ='';
const TELEGRAM_CHAT_ID ='';

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
        'VINEUSDT',
        'GOATUSDT', 
        'ETHUSDT',
        'SKYAIUSDT',
        'SIRENUSDT',
        'GRIFFAINUSDT',
        'ZEREBROUSDT',
        'DOODUSDT',
        'AVAAIUSDT',
        'JELLYJELLYUSDT',
        'VELVETUSDT',
        'SWARMSUSDT',
        'BULLAUSDT',
        'ARCUSDT',
        'HIPPOUSDT',
        'B2USDT',
        'FUSDT',
        'PIPPINUSDT',
        'PORT3USDT',
        'BIDUSDT',
        'FHEUSDT',
        'BRUSDT',
        'DMCUSDT',
        'MILKUSDT',
        'OBOLUSDT',
        'IDOLUSDT',
        'PUMPUSDT',
        'SKATEUSDT',
        'TAUSDT',
        'KOMAUSDT',
        'EPTUSDT',
        'TANSSIUSDT',
        'AGTUSDT',
        'BDXNUSDT',
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
        this.symbols = new Map(); // symbol -> KlineManager
        this.connections = new Map(); // symbol -> WebSocket
    }

    // 添加新的监控币种
    addSymbol(symbol) {
        if (!this.symbols.has(symbol)) {
            this.symbols.set(symbol, new KlineManager(CONFIG.historyLimit, symbol));
            console.log(`✅ 添加监控币种: ${symbol}`);
            return true;
        }
        console.log(`⚠️ ${symbol} 已在监控列表中`);
        return false;
    }

    // 移除监控币种
    removeSymbol(symbol) {
        if (this.symbols.has(symbol)) {
            // 关闭WebSocket连接
            if (this.connections.has(symbol)) {
                this.connections.get(symbol).terminate();
                this.connections.delete(symbol);
            }
            this.symbols.delete(symbol);
            console.log(`❌ 移除监控币种: ${symbol}`);
            return true;
        }
        return false;
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
    }

    // 获取WebSocket连接
    getConnection(symbol) {
        return this.connections.get(symbol);
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
    }

    // 添加新的K线数据并维护滑动窗口
    addKline(klineData) {
        // 检查是否是重复数据
        if (this.klines.length > 0) {
            const lastKline = this.klines[this.klines.length - 1];
            if (lastKline.openTime === klineData.openTime) {
                // 更新最后一根K线数据（实时更新）
                this.klines[this.klines.length - 1] = klineData;
                return;
            }
        }

        // 添加新的K线
        this.klines.push(klineData);
        
        // 维护滑动窗口：保持最新的30根K线
        while (this.klines.length > this.maxLength) {
            this.klines.shift(); // 移除最旧的K线
        }

        this.lastUpdateTime = Date.now();
        // 移除调试信息以保持界面清洁
        // console.log(`📊 ${this.symbol} 滑动窗口更新 - 当前K线数: ${this.klines.length}`);
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
    // 分析当前成交量相对于历史均值的情况
    analyzeVolume(currentVolume) {
        const stats = this.getVolumeStats();
        if (!stats || stats.count < 5) { // 至少需要5根历史K线才能分析
            return {
                symbol: this.symbol,
                currentVolume,
                averageVolume: 0,
                difference: 0,
                percentageChange: 0,
                volumeLevel: '数据不足',
                isAboveAverage: false,
                historicalCount: stats ? stats.count : 0
            };
        }

        const avgVolume = stats.average;
        const difference = currentVolume - avgVolume;
        const percentageChange = (difference / avgVolume) * 100;

        let volumeLevel = '正常';
        if (percentageChange > 50) {
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
            currentVolume,
            averageVolume: avgVolume,
            difference,
            percentageChange,
            volumeLevel,
            isAboveAverage: currentVolume > avgVolume,
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
            trades: parseInt(kline[8])
        }));

        const klineManager = multiManager.getKlineManager(symbol);
        if (klineManager) {
            historicalKlines.forEach(kline => {
                klineManager.addKline(kline);
            });
            klineManager.isInitialized = true;

            const stats = klineManager.getVolumeStats();
            console.log(`✅ ${symbol} 数据加载完成 - 平均成交量: ${stats.average.toFixed(2)}`);
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
    
    const ws = new WebSocket(wsUrl, {
        agent: agent,
        handshakeTimeout: 15000,
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Multi-Symbol Volume Monitor)'
        }
    });

    ws.on('open', () => {
        console.log(`🔗 ${symbol} WebSocket连接成功`);
    });

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
                    isCompleted: klineData.x // K线是否已完成
                };

                // 更新K线管理器（包括进行中的K线）
                const klineManager = multiManager.getKlineManager(symbol);
                if (klineManager && klineManager.isInitialized) {
                    klineManager.addKline(currentKline);
                    
                    // 如果K线已完成，进行详细分析
                    if (klineData.x) {
                        handleCompletedKline(symbol, currentKline);
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
        setTimeout(() => {
            console.log(`🔄 ${symbol} 尝试重连...`);
            connectWebSocketForSymbol(symbol);
        }, 5000);
    });

    ws.on('close', () => {
        console.log(`⚠️ ${symbol} WebSocket连接断开`);
        setTimeout(() => {
            console.log(`🔄 ${symbol} 尝试重连...`);
            connectWebSocketForSymbol(symbol);
        }, 5000);
    });

    multiManager.setConnection(symbol, ws);
    return ws;
}

// 处理完成的K线数据
async function handleCompletedKline(symbol, klineData) {
    const klineManager = multiManager.getKlineManager(symbol);
    if (!klineManager || !klineManager.isInitialized) {
        return;
    }

    // K线数据已经在WebSocket处理中添加，这里只需要进行分析
    const analysis = klineManager.analyzeVolume(klineData.volume);
    
    if (analysis) {
        const timeStr = new Date(klineData.closeTime).toLocaleString('zh-CN');
        const priceChange = klineData.close > klineData.open ? '📈' : '📉';
        const priceChangePercent = ((klineData.close - klineData.open) / klineData.open * 100).toFixed(2);
        
        // 检查是否为异常成交量
        const isAbnormal = Math.abs(analysis.percentageChange) > 30;
        
        if (isAbnormal) {
            // 异常成交量：获取详细信息并整合显示
            const tokenDetails = await getCachedTokenDetails(symbol);
            
            // 控制台输出
            console.log(`\n🚨 ====== ${symbol} 异常成交量警报 ======`);
            console.log(`⏰ 时间: ${timeStr}`);
            console.log(`💰 价格变化: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
            console.log(`📊 成交量异常: ${analysis.currentVolume.toFixed(0)} | 30根均值: ${analysis.averageVolume.toFixed(0)}`);
            console.log(`📊 异常程度: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}`);
            console.log(`📊 历史数据: ${analysis.historicalCount}根K线`);
            
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
            
            console.log(`🔥 警报: ${symbol} 成交量${analysis.percentageChange > 0 ? '异常放量' : '异常缩量'}！`);
            console.log(`==========================================`);
            
            // 构建Telegram消息
            let telegramMessage = `🚨 ${symbol} 异常成交量警报\n\n`;
            telegramMessage += `⏰ 时间: ${timeStr}\n`;
            telegramMessage += `💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)\n`;
            telegramMessage += `📊 成交量: ${analysis.currentVolume.toFixed(0)} | 30根均值: ${analysis.averageVolume.toFixed(0)}\n`;
            telegramMessage += `📊 异常程度: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}\n`;
            telegramMessage += `📊 历史数据: ${analysis.historicalCount}根K线\n\n`;
            
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
            
            telegramMessage += `🔥 警报: ${symbol} 成交量${analysis.percentageChange > 0 ? '异常放量' : '异常缩量'}！`;
            
            // 发送到Telegram
            enqueueTelegramMessage(telegramMessage);
            
        } else {
            // 正常成交量：简单显示
            console.log(`\n✅ ${symbol} K线完成 | ${timeStr}`);
            console.log(`💰 价格: ${klineData.open} → ${klineData.close} (${priceChange} ${priceChangePercent}%)`);
            console.log(`📊 成交量: ${analysis.currentVolume.toFixed(0)} | 30根均值: ${analysis.averageVolume.toFixed(0)}`);
            console.log(`📊 变化: ${analysis.percentageChange.toFixed(1)}% | 评级: ${analysis.volumeLevel}`);
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

    const currentVolume = parseFloat(klineData.volume);
    const analysis = klineManager.analyzeVolume(currentVolume);

    if (analysis && analysis.historicalCount >= 5) {
        const timeStr = new Date(klineData.closeTime).toLocaleString('zh-CN');
        const priceChange = klineData.close > klineData.open ? '📈' : '📉';
        const priceChangePercent = ((klineData.close - klineData.open) / klineData.open * 100).toFixed(2);

        console.log(`📊 ${symbol} 进行中 | ${timeStr} | 价格: ${klineData.close} (${priceChange}${priceChangePercent}%) | 成交量: ${analysis.volumeLevel} (${analysis.percentageChange.toFixed(1)}%)`);
    }
}

// 交互式命令行界面
function createInterface() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let isWaitingForInput = false;

    function showMenu() {
        console.log('\n📋 ===== 多币种K线监控控制台 =====');
        console.log('1. 添加监控币种');
        console.log('2. 移除监控币种');
        console.log('3. 查看当前监控列表');
        console.log('4. 查看热门币种列表');
        console.log('5. 批量添加热门币种');
        console.log('6. 查看实时状态详情');
        console.log('7. 清空所有监控');
        console.log('8. 退出程序');
        console.log('================================\n');
    }

    function promptCommand() {
        if (isWaitingForInput) return;
        isWaitingForInput = true;
        
        setTimeout(() => {
            rl.question('🎯 请输入命令编号 (1-8): ', async (answer) => {
                isWaitingForInput = false;
                console.log(''); // 添加空行分隔
                
                switch (answer.trim()) {
                    case '1':
                        rl.question('💰 请输入币种名称 (如: BTCUSDT): ', async (symbol) => {
                            symbol = symbol.trim().toUpperCase();
                            if (symbol) {
                                console.log(`🔄 正在添加 ${symbol}...`);
                                if (multiManager.addSymbol(symbol)) {
                                    const success = await fetchHistoricalKlines(symbol);
                                    if (success) {
                                        connectWebSocketForSymbol(symbol);
                                        console.log(`✅ ${symbol} 监控启动成功！`);
                                    } else {
                                        console.log(`❌ ${symbol} 添加失败`);
                                    }
                                }
                            }
                            console.log('\n' + '='.repeat(50));
                            promptCommand();
                        });
                        break;

                    case '2':
                        rl.question('🗑️ 请输入要移除的币种名称: ', (symbol) => {
                            symbol = symbol.trim().toUpperCase();
                            if (symbol) {
                                if (multiManager.removeSymbol(symbol)) {
                                    console.log(`✅ ${symbol} 已移除监控`);
                                } else {
                                    console.log(`❌ ${symbol} 不在监控列表中`);
                                }
                            }
                            console.log('\n' + '='.repeat(50));
                            promptCommand();
                        });
                        break;

                    case '3':
                        const currentSymbols = multiManager.getSymbols();
                        console.log(`📊 当前监控 ${currentSymbols.length} 个币种:`);
                        if (currentSymbols.length === 0) {
                            console.log('   暂无监控币种');
                        } else {
                            currentSymbols.forEach((symbol, index) => {
                                const manager = multiManager.getKlineManager(symbol);
                                const stats = manager.getVolumeStats();
                                console.log(`   ${index + 1}. ${symbol} - 平均成交量: ${stats ? stats.average.toFixed(0) : '加载中'}`);
                            });
                        }
                        console.log('\n' + '='.repeat(50));
                        promptCommand();
                        break;

                    case '4':
                        console.log('🔥 热门币种列表:');
                        POPULAR_SYMBOLS.forEach((symbol, index) => {
                            console.log(`   ${(index + 1).toString().padStart(2, ' ')}. ${symbol}`);
                        });
                        console.log('\n' + '='.repeat(50));
                        promptCommand();
                        break;

                    case '5':
                        rl.question('🎯 请输入要添加的币种编号 (用逗号分隔，如: 1,2,3): ', async (input) => {
                            const indices = input.split(',').map(i => parseInt(i.trim()) - 1);
                            let addedCount = 0;
                            
                            for (const index of indices) {
                                if (index >= 0 && index < POPULAR_SYMBOLS.length) {
                                    const symbol = POPULAR_SYMBOLS[index];
                                    console.log(`🔄 正在添加 ${symbol}...`);
                                    if (multiManager.addSymbol(symbol)) {
                                        const success = await fetchHistoricalKlines(symbol);
                                        if (success) {
                                            connectWebSocketForSymbol(symbol);
                                            addedCount++;
                                        }
                                    }
                                } else {
                                    console.log(`❌ 编号 ${index + 1} 无效`);
                                }
                            }
                            
                            console.log(`✅ 成功添加 ${addedCount} 个币种到监控列表`);
                            console.log('\n' + '='.repeat(50));
                            promptCommand();
                        });
                        break;

                    case '6':
                        const monitoredSymbols = multiManager.getSymbols();
                        console.log(`📊 实时状态详情 (监控 ${monitoredSymbols.length} 个币种):`);
                        console.log(`${'='.repeat(70)}`);
                        
                        if (monitoredSymbols.length === 0) {
                            console.log('   暂无监控币种');
                        } else {
                            monitoredSymbols.forEach((symbol, index) => {
                                const manager = multiManager.getKlineManager(symbol);
                                const status = manager.getStatusSummary();
                                const stats = manager.getVolumeStats();
                                
                                console.log(`${index + 1}. ${symbol}:`);
                                console.log(`   ├─ 状态: ${status.initialized ? '✅ 运行中' : '❌ 未初始化'}`);
                                console.log(`   ├─ K线数据: ${status.klineCount}根 (已完成: ${status.completedKlineCount}根)`);
                                console.log(`   ├─ 平均成交量: ${status.averageVolume}`);
                                console.log(`   ├─ 最后更新: ${status.lastUpdate}`);
                                
                                if (stats) {
                                    console.log(`   ├─ 成交量范围: ${stats.min.toFixed(0)} - ${stats.max.toFixed(0)}`);
                                    console.log(`   └─ 窗口状态: ${stats.windowSize}/${manager.maxLength} (${((stats.windowSize/manager.maxLength)*100).toFixed(1)}%)`);
                                } else {
                                    console.log(`   └─ 数据状态: 等待数据中...`);
                                }
                                console.log('');
                            });
                        }
                        console.log('\n' + '='.repeat(50));
                        promptCommand();
                        break;

                    case '7':
                        const symbolsToRemove = multiManager.getSymbols();
                        symbolsToRemove.forEach(symbol => {
                            multiManager.removeSymbol(symbol);
                        });
                        console.log(`✅ 已清空所有监控 (共移除 ${symbolsToRemove.length} 个币种)`);
                        console.log('\n' + '='.repeat(50));
                        promptCommand();
                        break;

                    case '8':
                        console.log('👋 正在退出程序...');
                        rl.close();
                        process.exit(0);
                        break;

                    default:
                        console.log('❌ 无效命令，请输入 1-8 之间的数字');
                        console.log('\n' + '='.repeat(50));
                        promptCommand();
                }
            });
        }, 100); // 小延时确保显示顺序
    }

    showMenu();
    promptCommand();

    return rl;
}

// 主程序
async function main() {
    console.log('🚀 启动多币种K线成交量监控程序...\n');
    
    // 批量添加默认监控币种
    console.log(`📋 准备添加 ${CONFIG.defaultSymbols.length} 个默认监控币种...\n`);
    
    for (const symbol of CONFIG.defaultSymbols) {
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
    
    console.log(`🎉 默认币种添加完成！当前监控 ${multiManager.getSymbols().length} 个币种\n`);

    // 启动交互式界面
    createInterface();
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