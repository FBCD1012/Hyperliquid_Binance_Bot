const { KlineManager } = require('./src/Binance/tradingVolum.js');

// 测试买入量对比功能
async function testVolumeComparison() {
    console.log('🧪 测试买入量对比功能...\n');
    
    // 创建KlineManager实例
    const klineManager = new KlineManager(30, 'BTCUSDT');
    
    // 模拟添加一些历史K线数据
    const mockKlines = [
        { volume: 1000, buyVolume: 500, open: 50000, close: 50100, closeTime: Date.now() - 300000 },
        { volume: 1200, buyVolume: 600, open: 50100, close: 50200, closeTime: Date.now() - 240000 },
        { volume: 1100, buyVolume: 550, open: 50200, close: 50300, closeTime: Date.now() - 180000 },
        { volume: 1300, buyVolume: 650, open: 50300, close: 50400, closeTime: Date.now() - 120000 },
        { volume: 1400, buyVolume: 700, open: 50400, close: 50500, closeTime: Date.now() - 60000 },
        { volume: 1500, buyVolume: 750, open: 50500, close: 50600, closeTime: Date.now() }
    ];
    
    // 添加K线数据
    mockKlines.forEach(kline => {
        klineManager.addKline(kline);
    });
    
    console.log('📊 模拟K线数据已添加');
    console.log(`📈 历史K线数量: ${klineManager.klines.length}`);
    
    // 测试不同的买入量场景
    const testScenarios = [
        { buyVolume: 800, description: '正常买入量' },
        { buyVolume: 1500, description: '轻微放量' },
        { buyVolume: 2500, description: '明显放量' },
        { buyVolume: 4000, description: '剧烈放量' },
        { buyVolume: 6000, description: '极端放量 (>200%)' }
    ];
    
    console.log('\n🔍 测试不同买入量场景:\n');
    
    testScenarios.forEach((scenario, index) => {
        console.log(`📋 测试场景 ${index + 1}: ${scenario.description}`);
        console.log(`📊 测试买入量: ${scenario.buyVolume}`);
        
        const comparison = klineManager.compareBuyVolumeWithAverageVolume(scenario.buyVolume);
        
        console.log(`📊 历史均值成交量: ${comparison.averageVolume.toFixed(0)}`);
        console.log(`📊 变化百分比: ${comparison.percentageChange > 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%`);
        console.log(`📊 分析结果: ${comparison.comparison}`);
        console.log(`📊 分析说明: ${comparison.message}`);
        console.log(`🚨 是否超过200%: ${comparison.percentageChange > 200 ? '是' : '否'}`);
        console.log('─'.repeat(60));
    });
    
    // 测试统计信息
    console.log('\n📊 成交量统计信息:');
    const stats = klineManager.getVolumeStats();
    if (stats) {
        console.log(`📊 平均成交量: ${stats.average.toFixed(0)}`);
        console.log(`📊 最高成交量: ${stats.max.toFixed(0)}`);
        console.log(`📊 最低成交量: ${stats.min.toFixed(0)}`);
        console.log(`📊 历史K线数量: ${stats.count}`);
    }
    
    console.log('\n✅ 测试完成！');
}

// 运行测试
if (require.main === module) {
    testVolumeComparison().catch(console.error);
}

module.exports = { testVolumeComparison };
