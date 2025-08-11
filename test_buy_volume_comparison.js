const { KlineManager } = require('./src/Binance/tradingVolum.js');

// 测试买入量对比功能
async function testBuyVolumeComparison() {
    console.log('🧪 测试买入量对比功能...\n');
    
    // 创建KlineManager实例
    const klineManager = new KlineManager(30, 'BTCUSDT');
    
    // 模拟添加一些历史K线数据（至少5根）
    const mockKlines = [
        { volume: 1000, buyVolume: 500, open: 50000, close: 50100, closeTime: Date.now() - 300000 },
        { volume: 1200, buyVolume: 600, open: 50100, close: 50200, closeTime: Date.now() - 240000 },
        { volume: 1100, buyVolume: 550, open: 50200, close: 50300, closeTime: Date.now() - 180000 },
        { volume: 1300, buyVolume: 650, open: 50300, close: 50400, closeTime: Date.now() - 120000 },
        { volume: 1400, buyVolume: 700, open: 50400, close: 50500, closeTime: Date.now() - 60000 }
    ];
    
    // 添加模拟数据
    mockKlines.forEach(kline => {
        klineManager.addKline(kline);
    });
    
    console.log(`📊 模拟K线数据已添加`);
    console.log(`📈 历史K线数量: ${klineManager.klines.length}\n`);
    
    // 测试不同买入量场景
    const testScenarios = [
        { name: '正常买入量', buyVolume: 800 },
        { name: '轻微放量', buyVolume: 1500 },
        { name: '明显放量', buyVolume: 2500 },
        { name: '剧烈放量', buyVolume: 4000 },
        { name: '极端放量 (>200%)', buyVolume: 6000 }
    ];
    
    console.log('🔍 测试不同买入量场景:\n');
    
    testScenarios.forEach((scenario, index) => {
        console.log(`📋 测试场景 ${index + 1}: ${scenario.name}`);
        
        const comparison = klineManager.compareBuyVolumeWithAverageVolume(scenario.buyVolume);
        
        console.log(`📊 测试买入量: ${scenario.buyVolume}`);
        console.log(`📊 历史均值成交量: ${comparison.averageVolume.toFixed(0)}`);
        console.log(`📊 变化百分比: ${comparison.percentageChange >= 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%`);
        console.log(`📊 分析结果: ${comparison.comparison}`);
        console.log(`📊 分析说明: ${comparison.message}`);
        console.log(`🚨 是否超过200%: ${comparison.percentageChange > 200 ? '是' : '否'}`);
        console.log(`${'─'.repeat(64)}`);
    });
    
    // 测试成交量统计
    console.log('\n📊 成交量统计信息:');
    const volumeStats = klineManager.getVolumeStats();
    console.log(`   📈 总成交量: ${volumeStats.totalVolume.toFixed(0)}`);
    console.log(`   📊 平均成交量: ${volumeStats.averageVolume.toFixed(0)}`);
    console.log(`   📉 最小成交量: ${volumeStats.minVolume.toFixed(0)}`);
    console.log(`   📈 最大成交量: ${volumeStats.maxVolume.toFixed(0)}`);
    console.log(`   📊 标准差: ${volumeStats.standardDeviation.toFixed(0)}`);
    
    console.log('\n✅ 测试完成！');
}

// 运行测试
testBuyVolumeComparison().catch(console.error);
