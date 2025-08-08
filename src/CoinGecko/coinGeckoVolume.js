require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 全局代理配置
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

// 全局 axios 实例
const axiosInstance = axios.create(agent ? { httpsAgent: agent } : {});

// 获取 CoinGecko 支持的所有代币列表
async function getAllCoinGeckoTokens() {
    try {
        console.log('-----------------------------');
        console.log('正在获取 CoinGecko 支持的所有代币列表...');
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/coins/list'
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('CoinGecko 代币总数:', res.data.length);
        console.log('前20个代币示例:');
        res.data.slice(0, 20).forEach((coin, index) => {
            console.log(`${index + 1}. ${coin.name} (${coin.symbol.toUpperCase()}) - ID: ${coin.id}`);
        });
        
        // 显示统计信息
        const uniqueSymbols = [...new Set(res.data.map(coin => coin.symbol))];
        console.log('\n📊 统计信息:');
        console.log(`总代币数量: ${res.data.length}`);
        console.log(`唯一符号数量: ${uniqueSymbols.length}`);
        console.log(`前10个符号示例: ${uniqueSymbols.slice(0, 10).join(', ')}`);
        
        // 返回类似API文档的响应格式
        const responseData = res.data.map(coin => ({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name
        }));
        
        console.log('\n📋 API 响应格式示例 (前5个):');
        console.log(JSON.stringify(responseData.slice(0, 5), null, 2));
        
        return responseData;
    } catch (err) {
        console.error('获取 CoinGecko 代币列表失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 获取 CoinGecko 热门代币
async function getTrendingCoins() {
    try {
        console.log('-----------------------------');
        console.log('正在获取 CoinGecko 热门代币...');
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/search/trending'
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('热门代币列表:');
        res.data.coins.forEach((coin, index) => {
            const item = coin.item;
            console.log(`${index + 1}. ${item.name} (${item.symbol.toUpperCase()})`);
            console.log(`   ID: ${item.id}`);
            console.log(`   市值排名: #${item.market_cap_rank || 'N/A'}`);
            console.log(`   价格: $${item.price_btc} BTC`);
            console.log(`   24h涨跌: ${item.price_btc_change_24h ? item.price_btc_change_24h.toFixed(4) : 'N/A'}`);
            console.log(`   24h成交量: ${item.volume_24h ? item.volume_24h.toLocaleString() : 'N/A'}`);
            console.log('   ---');
        });
        
        return res.data.coins;
    } catch (err) {
        console.error('获取热门代币失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 获取 CoinGecko 市值排行榜
async function getTopMarketCapCoins(currency = 'usd', per_page = 50, page = 1) {
    try {
        console.log('-----------------------------');
        console.log(`正在获取 CoinGecko 市值排行榜 (${currency.toUpperCase()})...`);
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/coins/markets',
            params: {
                vs_currency: currency,
                order: 'market_cap_desc',
                per_page: per_page,
                page: page,
                sparkline: false,
                price_change_percentage: '24h,7d,30d'
            }
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log(`市值排行榜 (前${res.data.length}个):`);
        res.data.forEach((coin, index) => {
            console.log(`${index + 1}. ${coin.name} (${coin.symbol.toUpperCase()})`);
            console.log(`   价格: $${coin.current_price}`);
            console.log(`   市值: $${(coin.market_cap / 1e9).toFixed(2)}B`);
            console.log(`   24h涨跌: ${coin.price_change_percentage_24h ? coin.price_change_percentage_24h.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   7d涨跌: ${coin.price_change_percentage_7d_in_currency ? coin.price_change_percentage_7d_in_currency.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   30d涨跌: ${coin.price_change_percentage_30d_in_currency ? coin.price_change_percentage_30d_in_currency.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   24h成交量: $${(coin.total_volume / 1e6).toFixed(2)}M`);
            console.log(`   流通量: ${coin.circulating_supply ? coin.circulating_supply.toLocaleString() : 'N/A'}`);
            console.log('   ---');
        });
        
        return res.data;
    } catch (err) {
        console.error('获取市值排行榜失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 搜索 CoinGecko 代币
async function searchCoinGeckoTokens(query) {
    try {
        console.log('-----------------------------');
        console.log(`正在搜索 CoinGecko 代币: "${query}"...`);
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/search',
            params: {
                query: query
            }
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log(`搜索结果 (共${res.data.coins.length}个):`);
        res.data.coins.slice(0, 10).forEach((coin, index) => {
            console.log(`${index + 1}. ${coin.name} (${coin.symbol.toUpperCase()})`);
            console.log(`   ID: ${coin.id}`);
            console.log(`   市值排名: #${coin.market_cap_rank || 'N/A'}`);
            console.log('   ---');
        });
        
        if (res.data.coins.length > 10) {
            console.log(`... 还有 ${res.data.coins.length - 10} 个结果`);
        }
        
        return res.data.coins;
    } catch (err) {
        console.error('搜索代币失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 获取 CoinGecko 支持的币种列表
async function getSupportedCurrencies() {
    try {
        console.log('-----------------------------');
        console.log('正在获取 CoinGecko 支持的币种列表...');
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/simple/supported_vs_currencies'
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('支持的币种列表:');
        res.data.forEach((currency, index) => {
            console.log(`${index + 1}. ${currency.toUpperCase()}`);
        });
        
        return res.data;
    } catch (err) {
        console.error('获取支持的币种失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 获取 CoinGecko 平台列表
async function getPlatforms() {
    try {
        console.log('-----------------------------');
        console.log('正在获取 CoinGecko 平台列表...');
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/asset_platforms'
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('平台列表:');
        res.data.slice(0, 20).forEach((platform, index) => {
            console.log(`${index + 1}. ${platform.name} (${platform.chain_identifier || 'N/A'})`);
            console.log(`   ID: ${platform.id}`);
            console.log(`   合约地址: ${platform.contract_address || 'N/A'}`);
            console.log('   ---');
        });
        
        if (res.data.length > 20) {
            console.log(`... 还有 ${res.data.length - 20} 个平台`);
        }
        
        return res.data;
    } catch (err) {
        console.error('获取平台列表失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// 批量获取代币详细信息
async function getBatchTokenDetails(ids = ['bitcoin', 'ethereum', 'binancecoin'], currency = 'usd') {
    try {
        console.log('-----------------------------');
        console.log(`正在批量获取代币详细信息 (${ids.length}个)...`);
        
        const config = {
            url: 'https://api.coingecko.com/api/v3/coins/markets',
            params: {
                vs_currency: currency,
                ids: ids.join(','),
                order: 'market_cap_desc',
                per_page: ids.length,
                page: 1,
                sparkline: false,
                price_change_percentage: '24h,7d,30d'
            }
        };
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('代币详细信息:');
        res.data.forEach((coin, index) => {
            console.log(`${index + 1}. ${coin.name} (${coin.symbol.toUpperCase()})`);
            console.log(`   价格: $${coin.current_price}`);
            console.log(`   市值: $${(coin.market_cap / 1e9).toFixed(2)}B`);
            console.log(`   24h涨跌: ${coin.price_change_percentage_24h ? coin.price_change_percentage_24h.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   7d涨跌: ${coin.price_change_percentage_7d_in_currency ? coin.price_change_percentage_7d_in_currency.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   30d涨跌: ${coin.price_change_percentage_30d_in_currency ? coin.price_change_percentage_30d_in_currency.toFixed(2) + '%' : 'N/A'}`);
            console.log(`   24h成交量: $${(coin.total_volume / 1e6).toFixed(2)}M`);
            console.log(`   流通量: ${coin.circulating_supply ? coin.circulating_supply.toLocaleString() : 'N/A'}`);
            console.log(`   总供应量: ${coin.total_supply ? coin.total_supply.toLocaleString() : 'N/A'}`);
            console.log(`   最大供应量: ${coin.max_supply ? coin.max_supply.toLocaleString() : 'N/A'}`);
            console.log('   ---');
        });
        
        return res.data;
    } catch (err) {
        console.error('批量获取代币详细信息失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
        return [];
    }
}

// CoinGecko市值/流通量查询（多币种）
async function getCoinGeckoMarketInfo(ids = ['bitcoin','ethereum','binancecoin']) {
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
        const res = await axiosInstance.get(config.url, config);
        console.log('-----------------------------');
        console.log('CoinGecko 多币种市值/流通量:');
        res.data.forEach(coin => {
            console.log(`${coin.name} (${coin.symbol.toUpperCase()}): 价格 $${coin.current_price}, 市值 $${(coin.market_cap/1e9).toFixed(2)}B, 流通量 ${coin.circulating_supply ? coin.circulating_supply.toLocaleString() : 'N/A'}, 总供应量: ${coin.total_supply ? coin.total_supply.toLocaleString() : 'N/A'}, 最大供应量: ${coin.max_supply ? coin.max_supply.toLocaleString() : 'N/A'}, 24h涨跌: ${coin.price_change_percentage_24h ? coin.price_change_percentage_24h.toFixed(2)+'%' : 'N/A'}`);
        });
        console.log('-----------------------------');
    } catch (err) {
        console.error('CoinGecko Markets 查询失败:', err.message);
        if (err.response) {
            console.error('错误响应:', err.response.status, err.response.data);
        }
    }
}

// 币安交易对到 CoinGecko 币种 ID 的映射
const BINANCE_TO_COINGECKO_MAP = {
    // 主流币种
    'BTCUSDT': 'bitcoin',
    'ETHUSDT': 'ethereum',
    'BNBUSDT': 'binancecoin',
    'SOLUSDT': 'solana',
    'ADAUSDT': 'cardano',
    'DOTUSDT': 'polkadot',
    'AVAXUSDT': 'avalanche-2',
    'MATICUSDT': 'matic-network',
    'LINKUSDT': 'chainlink',
    'UNIUSDT': 'uniswap',
    'LTCUSDT': 'litecoin',
    'BCHUSDT': 'bitcoin-cash',
    'XRPUSDT': 'ripple',
    'TRXUSDT': 'tron',
    'ETCUSDT': 'ethereum-classic',
    'XLMUSDT': 'stellar',
    'XMRUSDT': 'monero',
    'DASHUSDT': 'dash',
    'ZECUSDT': 'zcash',
    'XTZUSDT': 'tezos',
    'ATOMUSDT': 'cosmos',
    'ONTUSDT': 'ontology',
    'IOTAUSDT': 'iota',
    'BATUSDT': 'basic-attention-token',
    'VETUSDT': 'vechain',
    'NEOUSDT': 'neo',
    'QTUMUSDT': 'qtum',
    'IOSTUSDT': 'iostoken',
    'THETAUSDT': 'theta-token',
    'ALGOUSDT': 'algorand',
    'ZILUSDT': 'zilliqa',
    'KNCUSDT': 'kyber-network',
    'ZRXUSDT': '0x',
    'COMPUSDT': 'compound-governance-token',
    'OMGUSDT': 'omisego',
    'DOGEUSDT': 'dogecoin',
    'SXPUSDT': 'sxp',
    'KAVAUSDT': 'kava',
    'BANDUSDT': 'band-protocol',
    'RLCUSDT': 'iexec-rlc',
    'WAVESUSDT': 'waves',
    'MKRUSDT': 'maker',
    'SNXUSDT': 'havven',
    'DEFIUSDT': 'defi-index',
    'YFIUSDT': 'yearn-finance',
    'BALUSDT': 'balancer',
    'CRVUSDT': 'curve-dao-token',
    'TRBUSDT': 'tellor',
    'RUNEUSDT': 'thorchain',
    'SUSHIUSDT': 'sushi',
    'EGLDUSDT': 'elrond-erd-2',
    'ICXUSDT': 'icon',
    'STORJUSDT': 'storj',
    'BLZUSDT': 'bluzelle',
    'FTMUSDT': 'fantom',
    'ENJUSDT': 'enjincoin',
    'FLMUSDT': 'flamingo-finance',
    'RENUSDT': 'republic-protocol',
    'KSMUSDT': 'kusama',
    'NEARUSDT': 'near',
    'AAVEUSDT': 'aave',
    'FILUSDT': 'filecoin',
    'RSRUSDT': 'reserve-rights',
    'LRCUSDT': 'loopring',
    'OCEANUSDT': 'ocean-protocol',
    'BELUSDT': 'bella-protocol',
    'AXSUSDT': 'axie-infinity',
    'ALPHAUSDT': 'alpha-finance',
    'ZENUSDT': 'horizen',
    'SKLUSDT': 'skale',
    'GRTUSDT': 'the-graph',
    '1INCHUSDT': '1inch',
    'CHZUSDT': 'chiliz',
    'SANDUSDT': 'the-sandbox',
    'ANKRUSDT': 'ankr',
    'LITUSDT': 'litentry',
    'UNFIUSDT': 'unifi-protocol-dao',
    'REEFUSDT': 'reef-finance',
    'RVNUSDT': 'ravencoin',
    'SFPUSDT': 'safepal',
    'XEMUSDT': 'nem',
    'BTCSTUSDT': 'bitcoin-standard-hashrate-token',
    'COTIUSDT': 'coti',
    'CHRUSDT': 'chromia',
    'MANAUSDT': 'decentraland',
    'ALICEUSDT': 'my-neighbor-alice',
    'HBARUSDT': 'hedera-hashgraph',
    'ONEUSDT': 'harmony',
    'LINAUSDT': 'linear',
    'STMXUSDT': 'stormx',
    'DENTUSDT': 'dent',
    'CELRUSDT': 'celer-network',
    'HOTUSDT': 'holochain',
    'MTLUSDT': 'metal',
    'OGNUSDT': 'origin-protocol',
    'NKNUSDT': 'nkn',
    'SCUSDT': 'siacoin',
    'DGBUSDT': 'digibyte',
    '1000SHIBUSDT': 'shiba-inu',
    'BAKEUSDT': 'bakerytoken',
    'GTCUSDT': 'gitcoin'
};

// 将币安交易对转换为 CoinGecko 币种 ID
function convertBinanceToCoinGecko(binanceSymbol) {
    return BINANCE_TO_COINGECKO_MAP[binanceSymbol] || null;
}

// 批量转换币安交易对为 CoinGecko 币种 ID
function convertBinanceSymbolsToCoinGecko(binanceSymbols) {
    const results = {
        converted: [],
        notFound: [],
        mapping: {}
    };
    
    binanceSymbols.forEach(symbol => {
        const coinGeckoId = convertBinanceToCoinGecko(symbol);
        if (coinGeckoId) {
            results.converted.push({
                binanceSymbol: symbol,
                coinGeckoId: coinGeckoId
            });
            results.mapping[symbol] = coinGeckoId;
        } else {
            results.notFound.push(symbol);
        }
    });
    
    return results;
}

// 获取币安交易对对应的 CoinGecko 信息
async function getBinanceSymbolsCoinGeckoInfo(binanceSymbols) {
    try {
        console.log('-----------------------------');
        console.log('正在转换币安交易对为 CoinGecko 币种 ID...');
        
        const conversion = convertBinanceSymbolsToCoinGecko(binanceSymbols);
        
        console.log('-----------------------------');
        console.log('转换结果:');
        console.log(`✅ 成功转换: ${conversion.converted.length} 个`);
        console.log(`❌ 未找到映射: ${conversion.notFound.length} 个`);
        
        if (conversion.converted.length > 0) {
            console.log('\n📋 转换映射:');
            conversion.converted.forEach(item => {
                console.log(`  ${item.binanceSymbol} → ${item.coinGeckoId}`);
            });
        }
        
        if (conversion.notFound.length > 0) {
            console.log('\n❌ 未找到映射的交易对:');
            conversion.notFound.forEach(symbol => {
                console.log(`  ${symbol}`);
            });
        }
        
        // 获取 CoinGecko 详细信息
        if (conversion.converted.length > 0) {
            const coinGeckoIds = conversion.converted.map(item => item.coinGeckoId);
            console.log('\n📊 获取 CoinGecko 详细信息...');
            await getBatchTokenDetails(coinGeckoIds, 'usd');
        }
        
        return conversion;
    } catch (error) {
        console.error('获取币安交易对 CoinGecko 信息失败:', error.message);
        return null;
    }
}

// 测试转换功能
async function testConversion() {
    const testSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
        'DOTUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
        'LTCUSDT', 'BCHUSDT', 'XRPUSDT', 'TRXUSDT', 'ETCUSDT',
        'XLMUSDT', 'XMRUSDT', 'DASHUSDT', 'ZECUSDT', 'XTZUSDT'
    ];
    
    console.log('🧪 测试币安交易对转换功能...');
    return await getBinanceSymbolsCoinGeckoInfo(testSymbols);
}

async function main() {
    // 示例1: 获取所有 CoinGecko 代币列表
    // await getAllCoinGeckoTokens();
    
    // 示例2: 获取热门代币
    // await getTrendingCoins();
    
    // 示例3: 获取市值排行榜
    // await getTopMarketCapCoins('usd', 20, 1);
    
    // 示例4: 搜索代币
    // await searchCoinGeckoTokens('bitcoin');
    
    // 示例5: 获取支持的币种
    // await getSupportedCurrencies();
    
    // 示例6: 获取平台列表
    // await getPlatforms();
    
    // 示例7: 批量获取代币详细信息
    // await getBatchTokenDetails(['bitcoin', 'ethereum', 'binancecoin', 'solana', 'cardano'], 'usd');
    
    // 示例8: 原有的市值查询
    // await getCoinGeckoMarketInfo(['bitcoin', 'ethereum', 'binancecoin']);
    
    // 示例9: 测试币安交易对转换
    await testConversion();
}

main();
