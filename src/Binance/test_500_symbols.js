const fs = require('fs');
const path = require('path');

// 测试500币种监控系统
async function test500SymbolsSystem() {
    console.log('🧪 测试500币种监控系统...\n');
    
    // 1. 检查是否存在筛选结果文件
    const possibleFiles = [
        'low_market_cap_trading_pairs.js',
        'filtered_trading_pairs_by_market_cap.json',
        'trading_pairs.json'
    ];
    
    let foundFile = null;
    for (const file of possibleFiles) {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            foundFile = file;
            console.log(`✅ 发现币种文件: ${file}`);
            break;
        }
    }
    
    if (!foundFile) {
        console.log('❌ 未找到币种文件，请先运行 getAllCoinPairInfo.js 生成筛选结果');
        return;
    }
    
    // 2. 读取文件内容
    const filePath = path.join(__dirname, foundFile);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    let symbols = [];
    
    // 3. 解析文件内容
    if (foundFile.endsWith('.js')) {
        // JavaScript数组格式
        const match = fileContent.match(/const\s+\w+\s*=\s*\[([\s\S]*?)\];/);
        if (match) {
            const arrayContent = match[1];
            symbols = arrayContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.startsWith("'") && line.endsWith("',"))
                .map(line => line.slice(1, -2));
        }
    } else if (foundFile.endsWith('.json')) {
        // JSON格式
        try {
            const data = JSON.parse(fileContent);
            if (Array.isArray(data)) {
                symbols = data;
            } else if (data.symbols && Array.isArray(data.symbols)) {
                symbols = data.symbols;
            } else if (data.filteredTradingPairs && Array.isArray(data.filteredTradingPairs)) {
                symbols = data.filteredTradingPairs.map(item => item.tradingPair);
            }
        } catch (e) {
            console.error('❌ JSON解析失败:', e.message);
            return;
        }
    }
    
    console.log(`📊 从文件 ${foundFile} 中读取到 ${symbols.length} 个币种`);
    
    // 4. 验证币种格式
    const validSymbols = symbols.filter(symbol => {
        return typeof symbol === 'string' && symbol.length > 0 && symbol.includes('USDT');
    });
    
    console.log(`✅ 有效币种数量: ${validSymbols.length}`);
    
    if (validSymbols.length === 0) {
        console.log('❌ 未找到有效的币种数据');
        return;
    }
    
    // 5. 显示前10个币种作为示例
    console.log('\n📋 前10个币种示例:');
    validSymbols.slice(0, 10).forEach((symbol, index) => {
        console.log(`  ${index + 1}. ${symbol}`);
    });
    
    if (validSymbols.length > 10) {
        console.log(`  ... 还有 ${validSymbols.length - 10} 个币种`);
    }
    
    // 6. 系统资源估算
    const estimatedMemory = Math.round(validSymbols.length * 0.5); // 每个币种约0.5MB内存
    const estimatedConnections = Math.min(validSymbols.length, 100); // 最大100个并发连接
    
    console.log('\n💡 系统资源估算:');
    console.log(`  📊 监控币种数: ${validSymbols.length}`);
    console.log(`  🔗 并发连接数: ${estimatedConnections}/100`);
    console.log(`  💾 预估内存使用: ${estimatedMemory}MB`);
    console.log(`  ⏱️  预计启动时间: ${Math.ceil(validSymbols.length / 10)}秒`);
    
    // 7. 使用建议
    console.log('\n🎯 使用建议:');
    if (validSymbols.length > 800) {
        console.log('  ⚠️  币种数量较多，建议分批监控或增加系统资源');
    } else if (validSymbols.length > 500) {
        console.log('  ✅ 币种数量适中，系统可以正常处理');
    } else {
        console.log('  ✅ 币种数量较少，系统运行会很流畅');
    }
    
    console.log('\n🚀 启动命令:');
    console.log(`  node tradingVolume.js`);
    console.log(`  # 或者指定文件:`);
    console.log(`  node tradingVolume.js ${foundFile}`);
    
    console.log('\n📖 更多信息请查看: README_500_symbols.md');
}

// 运行测试
test500SymbolsSystem().catch(console.error); 