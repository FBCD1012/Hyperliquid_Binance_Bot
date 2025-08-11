const { MultiSymbolKlineManager } = require('./tradingVolume');

// 测试连接恢复功能
async function testConnectionRecovery() {
    console.log('🧪 开始测试连接恢复功能...');
    
    const manager = new MultiSymbolKlineManager();
    
    // 添加一些测试币种
    const testSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    console.log(`📝 添加测试币种: ${testSymbols.join(', ')}`);
    
    for (const symbol of testSymbols) {
        manager.addSymbol(symbol);
    }
    
    console.log(`📊 初始状态: ${manager.getStats().totalSymbols} 个币种`);
    
    // 模拟清理不活跃连接
    console.log('🧹 模拟清理不活跃连接...');
    manager.cleanupInactiveConnections();
    
    console.log(`📊 清理后状态: ${manager.getStats().totalSymbols} 个币种`);
    
    // 测试恢复功能
    console.log('🔄 测试恢复功能...');
    await manager.reconnectCleanedSymbols();
    
    console.log(`📊 恢复后状态: ${manager.getStats().totalSymbols} 个币种`);
    
    console.log('✅ 测试完成');
}

// 运行测试
if (require.main === module) {
    testConnectionRecovery().catch(console.error);
}

module.exports = { testConnectionRecovery };
