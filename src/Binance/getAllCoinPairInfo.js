const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');

const proxy = 'http://127.0.0.1:7897'; // 例如 'http://127.0.0.1:7897'
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

// 创建axios实例
const axiosInstance = axios.create({
    httpsAgent: agent,
    timeout: 30000
});

// 延迟函数，避免API限制
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 从交易对提取基础货币
function extractBaseCurrency(symbol) {
    // 移除USDT、BUSD、USDC等稳定币后缀
    const stableCoins = ['USDT', 'BUSD', 'USDC', 'TUSD', 'DAI'];
    for (const stable of stableCoins) {
        if (symbol.endsWith(stable)) {
            return symbol.replace(stable, '');
        }
    }
    return symbol;
}

// 获取CoinGecko币种列表
async function getCoinGeckoList() {
    try {
        const response = await axiosInstance.get('https://api.coingecko.com/api/v3/coins/list');
        return response.data;
    } catch (error) {
        console.error('获取CoinGecko币种列表失败:', error.message);
        return [];
    }
}

// 批量查询CoinGecko市值信息
async function getCoinGeckoMarketInfo(coinIds) {
    try {
        const batchSize = 250; // CoinGecko API限制
        const results = [];
        
        for (let i = 0; i < coinIds.length; i += batchSize) {
            const batch = coinIds.slice(i, i + batchSize);
            console.log(`正在查询第 ${Math.floor(i/batchSize) + 1} 批，共 ${Math.ceil(coinIds.length/batchSize)} 批...`);
            
            const config = {
                url: 'https://api.coingecko.com/api/v3/coins/markets',
                params: {
                    vs_currency: 'usd',
                    ids: batch.join(','),
                    order: 'market_cap_desc',
                    per_page: batchSize,
                    page: 1,
                    sparkline: false
                }
            };
            
            const response = await axiosInstance.get(config.url, { params: config.params });
            results.push(...response.data);
            
            // 避免API限制，每次请求后延迟
            if (i + batchSize < coinIds.length) {
                await delay(1000);
            }
        }
        
        return results;
    } catch (error) {
        console.error('CoinGecko市值查询失败:', error.message);
        return [];
    }
}

async function getFuturesExchangeInfoWithMarketCap() {
    console.log('开始获取币安合约交易对信息...');
    
    // 1. 获取币安合约交易对
    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    const res = await axiosInstance.get(url);
    const symbolsArr = res.data.symbols.map(item => item.symbol);
    console.log('所有合约交易对数组:', symbolsArr);
    console.log('合约交易对总数:', symbolsArr.length);
    
    // 2. 提取基础货币
    const baseCurrencies = [...new Set(symbolsArr.map(symbol => extractBaseCurrency(symbol)))];
    console.log(`提取的基础货币数量: ${baseCurrencies.length}`);
    
    // 3. 获取CoinGecko币种列表
    console.log('正在获取CoinGecko币种列表...');
    const coinGeckoList = await getCoinGeckoList();
    console.log(`CoinGecko币种总数: ${coinGeckoList.length}`);
    
    // 4. 匹配币种ID
    const matchedCoins = [];
    baseCurrencies.forEach(currency => {
        const coin = coinGeckoList.find(item => 
            item.symbol.toLowerCase() === currency.toLowerCase() ||
            item.name.toLowerCase() === currency.toLowerCase()
        );
        if (coin) {
            matchedCoins.push({
                binanceSymbol: currency,
                coinGeckoId: coin.id,
                coinGeckoSymbol: coin.symbol,
                coinGeckoName: coin.name
            });
        }
    });
    
    console.log(`成功匹配的币种数量: ${matchedCoins.length}`);
    
    // 5. 批量查询市值信息
    console.log('正在查询市值信息...');
    const coinIds = matchedCoins.map(coin => coin.coinGeckoId);
    const marketData = await getCoinGeckoMarketInfo(coinIds);
    
    // 6. 筛选市值小于2.5亿美元的币种
    const targetMarketCap = 250000000; // 2.5亿美元
    const filteredCoins = marketData.filter(coin => 
        coin.market_cap && coin.market_cap < targetMarketCap
    );
    
    // 7. 找出对应的交易对
    const filteredTradingPairs = [];
    filteredCoins.forEach(coin => {
        const matchedCoin = matchedCoins.find(item => item.coinGeckoId === coin.id);
        if (matchedCoin) {
            const relatedPairs = symbolsArr.filter(symbol => 
                symbol.startsWith(matchedCoin.binanceSymbol)
            );
            
            relatedPairs.forEach(pair => {
                filteredTradingPairs.push({
                    tradingPair: pair,
                    baseCurrency: matchedCoin.binanceSymbol,
                    coinGeckoName: coin.name,
                    coinGeckoSymbol: coin.symbol,
                    currentPrice: coin.current_price,
                    marketCap: coin.market_cap,
                    marketCapFormatted: `$${(coin.market_cap / 1e6).toFixed(2)}M`,
                    volume24h: coin.total_volume,
                    priceChange24h: coin.price_change_percentage_24h,
                    circulatingSupply: coin.circulating_supply,
                    totalSupply: coin.total_supply,
                    maxSupply: coin.max_supply
                });
            });
        }
    });
    
    // 8. 按市值排序
    filteredTradingPairs.sort((a, b) => a.marketCap - b.marketCap);
    
    // 9. 输出结果
    console.log('\n============================');
    console.log(`市值小于2.5亿美元的交易对 (共${filteredTradingPairs.length}个):`);
    console.log('============================');
    
    filteredTradingPairs.forEach((item, index) => {
        console.log(`${index + 1}. ${item.tradingPair} | ${item.coinGeckoName} (${item.coinGeckoSymbol.toUpperCase()}) | 市值: ${item.marketCapFormatted} | 价格: $${item.currentPrice} | 24h涨跌: ${item.priceChange24h ? item.priceChange24h.toFixed(2) + '%' : 'N/A'}`);
    });
    
    // 10. 保存到文件
    const outputData = {
        timestamp: new Date().toISOString(),
        criteria: {
            maxMarketCap: targetMarketCap,
            maxMarketCapFormatted: '$250M'
        },
        summary: {
            totalBinancePairs: symbolsArr.length,
            matchedCoinsCount: matchedCoins.length,
            filteredPairsCount: filteredTradingPairs.length
        },
        filteredTradingPairs: filteredTradingPairs
    };
    
    const outputPath = path.join(__dirname, 'filtered_trading_pairs_by_market_cap.json');
    try {
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`\n筛选结果已保存到文件: ${outputPath}`);
    } catch (error) {
        console.error('保存文件时出错:', error);
    }
    
    // 11. 生成简洁的交易对数组文件
    const tradingPairSymbols = filteredTradingPairs.map(item => item.tradingPair);
    
    // 创建JavaScript数组格式的文件内容
    const arrayFileContent = `// 市值小于2.5亿美元的币安合约交易对
// 生成时间: ${new Date().toISOString()}
// 总数量: ${tradingPairSymbols.length}个交易对

const lowMarketCapTradingPairs = [
${tradingPairSymbols.map(symbol => `    '${symbol}',`).join('\n')}
];

module.exports = lowMarketCapTradingPairs;`;

    const arrayOutputPath = path.join(__dirname, 'low_market_cap_trading_pairs.js');
    try {
        fs.writeFileSync(arrayOutputPath, arrayFileContent);
        console.log(`\n交易对数组已保存到文件: ${arrayOutputPath}`);
        console.log(`文件包含 ${tradingPairSymbols.length} 个市值小于2.5亿美元的交易对`);
    } catch (error) {
        console.error('保存数组文件时出错:', error);
    }
    
    return filteredTradingPairs;
}

// 执行主函数
getFuturesExchangeInfoWithMarketCap().catch(console.error);