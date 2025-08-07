require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = process.env.PROXY;
const agent = new HttpsProxyAgent(proxy);

// 原有的交易对信息查询函数
async function getExchangeInfo() {
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

// 新增：持仓量历史查询函数
async function getOpenInterestHistory(symbol = 'BTCUSDT', period = '1h', limit = 30) {
    try {
        console.log('-----------------------------');
        console.log(`正在查询 ${symbol} 的持仓量历史数据...`);
        console.log(`时间周期: ${period}, 返回数量: ${limit}`);
        
        const res = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
            httpsAgent: agent,
            params: {
                symbol: symbol,
                period: period,
                limit: limit
            }
        });
        
        console.log('-----------------------------');
        console.log('持仓量历史数据:');
        console.log('数据条数:', res.data.length);
        
        // 显示最近5条数据作为示例
        const recentData = res.data.slice(0, 5);
        recentData.forEach((item, index) => {
            console.log(`\n第${index + 1}条数据:`);
            console.log('时间戳:', new Date(item[0]).toLocaleString());
            console.log('持仓量:', item[1]);
            console.log('合约价值:', item[2]);
        });
        
        if (res.data.length > 5) {
            console.log(`\n... 还有 ${res.data.length - 5} 条数据`);
        }
        
        return res.data;
    } catch (err) {
        console.error('持仓量历史查询失败:', err.response ? err.response.data : err);
        return null;
    }
}

// 新增：批量查询多个交易对的持仓量
async function getMultipleOpenInterestHistory(symbols = ['BTCUSDT', 'ETHUSDT'], period = '4h', limit = 20) {
    console.log('-----------------------------');
    console.log('批量查询多个交易对的持仓量历史...');
    
    for (const symbol of symbols) {
        await getOpenInterestHistory(symbol, period, limit);
        // 添加延迟避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// 新增：分析持仓量趋势
async function analyzeOpenInterestTrend(symbol = 'BTCUSDT', period = '1d', limit = 30) {
    try {
        const data = await getOpenInterestHistory(symbol, period, limit);
        if (!data || data.length === 0) {
            console.log('没有获取到数据');
            return;
        }
        
        console.log('-----------------------------');
        console.log(`${symbol} 持仓量趋势分析:`);
        
        // 计算变化趋势
        const firstValue = parseFloat(data[data.length - 1][1]);
        const lastValue = parseFloat(data[0][1]);
        const change = lastValue - firstValue;
        const changePercent = (change / firstValue) * 100;
        
        console.log(`起始持仓量: ${firstValue.toLocaleString()}`);
        console.log(`当前持仓量: ${lastValue.toLocaleString()}`);
        console.log(`变化量: ${change > 0 ? '+' : ''}${change.toLocaleString()}`);
        console.log(`变化百分比: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`);
        
        // 判断趋势
        if (changePercent > 5) {
            console.log('趋势: 📈 持仓量显著增加');
        } else if (changePercent < -5) {
            console.log('趋势: 📉 持仓量显著减少');
        } else {
            console.log('趋势: ➡️ 持仓量相对稳定');
        }
        
    } catch (err) {
        console.error('趋势分析失败:', err);
    }
}

async function main() {
    // 原有的交易对信息查询
    await getExchangeInfo();
    
    // 新增的持仓量历史查询功能
    console.log('\n========== 持仓量历史查询 ==========');
    
    // 1. 查询单个交易对的持仓量历史
    await getOpenInterestHistory('BTCUSDT', '1h', 10);
    
    // 2. 批量查询多个交易对
    await getMultipleOpenInterestHistory(['BTCUSDT', 'ETHUSDT'], '4h', 5);
    
    // 3. 分析持仓量趋势
    await analyzeOpenInterestTrend('BTCUSDT', '1d', 20);
}

main();