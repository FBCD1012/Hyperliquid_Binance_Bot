// 简单的KlineManager测试
class KlineManager {
    constructor(maxLength = 30, symbol = '') {
        this.maxLength = maxLength;
        this.symbol = symbol;
        this.klines = [];
        this.isInitialized = false;
        this.lastUpdateTime = Date.now();
    }

    addKline(klineData) {
        this.klines.push(klineData);
        if (this.klines.length > this.maxLength) {
            this.klines.shift();
        }
        this.lastUpdateTime = Date.now();
        this.isInitialized = this.klines.length >= 5;
    }

    calculateAverageVolume() {
        if (this.klines.length === 0) return 0;
        
        // 使用已完成的K线（排除最后一根进行中的K线）
        const completedKlines = this.klines.slice(0, -1);
        if (completedKlines.length === 0) return 0;
        
        const totalVolume = completedKlines.reduce((sum, kline) => {
            return sum + parseFloat(kline.volume || 0);
        }, 0);
        
        return totalVolume / completedKlines.length;
    }

    compareBuyVolumeWithAverageVolume(currentBuyVolume) {
        if (this.klines.length < 5) {
            return {
                symbol: this.symbol,
                currentBuyVolume: 0,
                averageVolume: 0,
                difference: 0,
                percentageChange: 0,
                comparison: '数据不足',
                isAboveAverage: false,
                historicalCount: this.klines.length,
                message: '暂无已完成的K线数据'
            };
        }

        const avgVolume = this.calculateAverageVolume();
        const difference = currentBuyVolume - avgVolume;
        const percentageChange = avgVolume > 0 ? (difference / avgVolume) * 100 : 0;

        let comparison = '正常';
        let message = '买入量在正常范围内';

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
        } else if (percentageChange < -15) {
            comparison = '明显缩量';
            message = '当前买入量低于历史均值，买入意愿有所减弱';
        } else if (percentageChange < -5) {
            comparison = '轻微缩量';
            message = '当前买入量略低于历史均值，市场表现正常';
        }

        return {
            symbol: this.symbol,
            currentBuyVolume,
            averageVolume: avgVolume,
            difference,
            percentageChange,
            comparison,
            isAboveAverage: currentBuyVolume > avgVolume,
            historicalCount: this.klines.length - 1, // 排除进行中的K线
            message
        };
    }
}

// 测试买入量对比功能
function testBuyVolumeComparison() {
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
    console.log(`📈 历史K线数量: ${klineManager.klines.length}`);
    console.log(`📊 平均成交量: ${klineManager.calculateAverageVolume().toFixed(0)}\n`);
    
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
    
    console.log('\n✅ 测试完成！');
}

// 运行测试
testBuyVolumeComparison();
