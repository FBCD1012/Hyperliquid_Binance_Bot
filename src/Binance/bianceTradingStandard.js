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

// 获取合约交易规则和上线时间
async function getContractTradingRules(symbol = 'BTCUSDT') {
    try {
        console.log('-----------------------------');
        console.log(`正在查询 ${symbol} 的合约交易规则和上线时间...`);
        
        const config = {
            url: 'https://fapi.binance.com/fapi/v1/exchangeInfo'
        };
        
        // 只有在代理有效时才添加 httpsAgent
        if (agent) {
            config.httpsAgent = agent;
        }
        
        const res = await axiosInstance.get(config.url, config);
        
        // 查找指定交易对
        const contract = res.data.symbols.find(item => item.symbol === symbol);
        if (contract) {
            console.log('-----------------------------');
            console.log('合约交易规则:');
            console.log('交易对:', contract.symbol);
            console.log('基础币种:', contract.baseAsset);
            console.log('计价币种:', contract.quoteAsset);
            console.log('合约上线时间:', new Date(contract.onboardDate).toLocaleString());
            console.log('合约状态:', contract.status);
            console.log('合约类型:', contract.contractType);
            console.log('交割日期:', contract.deliveryDate);
            console.log('价格精度:', contract.pricePrecision);
            console.log('数量精度:', contract.quantityPrecision);
            
            // 显示交易规则
            console.log('\n交易规则:');
            contract.filters.forEach((filter, index) => {
                console.log(`${index + 1}. ${filter.filterType}:`, filter);
            });
            
            // 显示订单类型
            console.log('\n支持的订单类型:', contract.orderTypes);
            
            return contract;
        } else {
            console.log(`未找到 ${symbol} 合约信息`);
            return null;
        }
    } catch (err) {
        console.error('查询合约交易规则失败:', err.response ? err.response.data : err.message);
        return null;
    }
}

// 查询最近三天的持仓量信息
async function getThreeDaysOpenInterest(symbol = 'BTCUSDT') {
    try {
        console.log('-----------------------------');
        console.log(`正在查询 ${symbol} 最近三天的持仓量信息...`);
        
        // 计算三天前的时间戳
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        
        const config = {
            url: 'https://fapi.binance.com/futures/data/openInterestHist',
            params: {
                symbol: symbol,
                period: '1d',  // 使用1天周期
                limit: 500     // 最大数量
            }
        };
        
        // 只有在代理有效时才添加 httpsAgent
        if (agent) {
            config.httpsAgent = agent;
        }
        
        const res = await axiosInstance.get(config.url, config);
        
        // 过滤最近三天的数据
        const recentData = res.data.filter(item => item.timestamp >= threeDaysAgo);
        
        console.log('-----------------------------');
        console.log('最近三天持仓量数据:');
        console.log('数据条数:', recentData.length);
        
        // 按日期分组显示
        const dailyData = {};
        recentData.forEach(item => {
            const date = new Date(item.timestamp).toLocaleDateString();
            if (!dailyData[date]) {
                dailyData[date] = [];
            }
            dailyData[date].push(item);
        });
        
        // 显示每天的数据
        Object.keys(dailyData).forEach(date => {
            console.log(`\n📅 ${date}:`);
            const dayData = dailyData[date];
            
            // 显示当天最高、最低、平均持仓量
            const openInterests = dayData.map(item => parseFloat(item.sumOpenInterest));
            const openInterestValues = dayData.map(item => parseFloat(item.sumOpenInterestValue));
            
            const maxOI = Math.max(...openInterests);
            const minOI = Math.min(...openInterests);
            const avgOI = openInterests.reduce((a, b) => a + b, 0) / openInterests.length;
            
            const maxOIV = Math.max(...openInterestValues);
            const minOIV = Math.min(...openInterestValues);
            const avgOIV = openInterestValues.reduce((a, b) => a + b, 0) / openInterestValues.length;
            
            console.log(`  持仓量 - 最高: ${maxOI.toFixed(2)}, 最低: ${minOI.toFixed(2)}, 平均: ${avgOI.toFixed(2)}`);
            console.log(`  持仓价值 - 最高: ${(maxOIV / 1000000).toFixed(2)}M USDT, 最低: ${(minOIV / 1000000).toFixed(2)}M USDT, 平均: ${(avgOIV / 1000000).toFixed(2)}M USDT`);
            
            // 显示当天所有时间点的数据
            dayData.forEach(item => {
                console.log(`    ${new Date(item.timestamp).toLocaleTimeString()}: 持仓量 ${item.sumOpenInterest}, 价值 ${(parseFloat(item.sumOpenInterestValue) / 1000000).toFixed(2)}M USDT`);
            });
        });
        
        return recentData;
    } catch (err) {
        console.error('查询最近三天持仓量失败:', err.response ? err.response.data : err.message);
        return null;
    }
}

// 查询持仓量历史数据
async function getOpenInterestHistory(symbol = 'BTCUSDT', period = '1h', limit = 30) {
    try {
        console.log('-----------------------------');
        console.log(`正在查询 ${symbol} 的持仓量历史数据...`);
        console.log(`时间周期: ${period}, 返回数量: ${limit}`);
        
        const config = {
            url: 'https://fapi.binance.com/futures/data/openInterestHist',
            params: {
                symbol: symbol,
                period: period,
                limit: limit
            }
        };
        
        // 只有在代理有效时才添加 httpsAgent
        if (agent) {
            config.httpsAgent = agent;
        }
        
        const res = await axiosInstance.get(config.url, config);
        
        console.log('-----------------------------');
        console.log('持仓量历史数据:');
        console.log('数据条数:', res.data.length);
        
        // 显示所有数据
        res.data.forEach((item, index) => {
            console.log(`\n第${index + 1}条数据:`);
            console.log('时间戳:', new Date(item.timestamp).toLocaleString());
            console.log('持仓量:', item.sumOpenInterest);
            console.log('持仓总价值:', item.sumOpenInterestValue);
            if (item.CMCCirculatingSupply) {
                console.log('CMC流通供应量:', item.CMCCirculatingSupply);
            }
        });
        
        return res.data;
    } catch (err) {
        console.error('持仓量历史查询失败:', err.response ? err.response.data : err.message);
        return null;
    }
}

// 查询当前持仓总价值
async function getCurrentOpenInterestValue(symbol = 'BTCUSDT') {
    try {
        console.log('-----------------------------');
        console.log(`正在查询 ${symbol} 的当前持仓总价值...`);
        
        const config = {
            url: 'https://fapi.binance.com/futures/data/openInterestHist',
            params: {
                symbol: symbol,
                period: '5m',
                limit: 1
            }
        };
        
        // 只有在代理有效时才添加 httpsAgent
        if (agent) {
            config.httpsAgent = agent;
        }
        
        const res = await axiosInstance.get(config.url, config);
        
        if (res.data && res.data.length > 0) {
            const latestData = res.data[0];
            console.log('-----------------------------');
            console.log('当前持仓数据:');
            console.log('时间:', new Date(latestData.timestamp).toLocaleString());
            console.log('持仓量:', latestData.sumOpenInterest);
            console.log('持仓总价值:', latestData.sumOpenInterestValue);
            
            return {
                timestamp: latestData.timestamp,
                openInterest: latestData.sumOpenInterest,
                openInterestValue: latestData.sumOpenInterestValue
            };
        } else {
            console.log('没有获取到持仓数据');
            return null;
        }
    } catch (err) {
        console.error('查询当前持仓总价值失败:', err.response ? err.response.data : err.message);
        return null;
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

// CoinGecko单币种详细信息
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
        const res = await axiosInstance.get(config.url, config);
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


async function main() {
    // 1. 查询合约交易规则和上线时间
    await getContractTradingRules('BTCUSDT');
    
     await getCoinGeckoMarketInfo(['bitcoin']);
    
    // 7. 查询最近三天的持仓量信息
    await getThreeDaysOpenInterest('BTCUSDT');
    
    // 8. 查询当前持仓总价值
    await getCurrentOpenInterestValue('BTCUSDT');
    
    // 9. 查询持仓量历史数据（保持原有逻辑）
    await getOpenInterestHistory('BTCUSDT', '1h', 10);
}

main();