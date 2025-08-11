// 测试15分钟时间窗口检测功能
const { KlineManager } = require('./src/Binance/tradingVolume.js');

// 模拟测试
function testTimeWindowDetection() {
    console.log('🧪 测试15分钟时间窗口检测功能...\n');
    
    // 创建KlineManager实例
    const manager = new KlineManager(30, 'TESTUSDT');
    
    // 模拟时间序列（每根K线间隔1分钟）
    const testCases = [
        { volume: 1000, percentageChange: 50, timestamp: Date.now() - (4 * 60 * 1000) }, // 4分钟前
        { volume: 1200, percentageChange: 60, timestamp: Date.now() - (3 * 60 * 1000) }, // 3分钟前
        { volume: 800, percentageChange: 20, timestamp: Date.now() - (2 * 60 * 1000) },  // 2分钟前
        { volume: 1500, percentageChange: 80, timestamp: Date.now() - (1 * 60 * 1000) }, // 1分钟前
        { volume: 2000, percentageChange: 100, timestamp: Date.now() },                   // 现在
    ];
    
    console.log('📊 测试数据:');
    testCases.forEach((testCase, index) => {
        const timeAgo = Math.round((Date.now() - testCase.timestamp) / 60000);
        console.log(`  K线${index + 1}: ${timeAgo}分钟前, 放量${testCase.percentageChange}%`);
    });
    
    console.log('\n🔍 开始测试...\n');
    
    // 模拟添加K线数据
    testCases.forEach((testCase, index) => {
        console.log(`\n--- 处理K线${index + 1} ---`);
        
        // 模拟时间
        const originalNow = Date.now;
        Date.now = () => testCase.timestamp;
        
        // 分析成交量
        const analysis = manager.analyzeComprehensiveTrend(testCase.volume);
        const consecutiveInfo = manager.checkConsecutiveAbnormal(analysis.volumeLevel, analysis.percentageChange);
        
        // 恢复时间
        Date.now = originalNow;
        
        console.log(`📊 放量程度: ${analysis.percentageChange.toFixed(1)}%`);
        console.log(`🔄 连续放量: ${consecutiveInfo.consecutiveCount}次`);
        console.log(`⏰ 15分钟时间窗口: ${consecutiveInfo.timeWindowAbnormalCount}次`);
        
        if (consecutiveInfo.timeWindowInfo.isInTimeWindow) {
            console.log(`⏰ 时间跨度: ${consecutiveInfo.timeWindowInfo.timeSpan.toFixed(1)}秒`);
        }
        
        console.log(`🚨 是否推送: ${analysis.shouldAlert ? '是' : '否'}`);
        if (analysis.alertReason) {
            console.log(`📝 推送原因: ${analysis.alertReason}`);
        }
    });
    
    console.log('\n✅ 测试完成！');
}

// 运行测试
if (require.main === module) {
    testTimeWindowDetection();
}

module.exports = { testTimeWindowDetection };
