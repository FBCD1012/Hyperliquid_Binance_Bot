# 500+ 币种监控系统使用指南

## 功能特性

✅ **大规模监控支持** - 支持监控500-1000个币种
✅ **智能连接池管理** - 自动管理WebSocket连接，避免连接数超限
✅ **内存优化** - 定期清理过期数据，优化内存使用
✅ **批量操作** - 支持批量添加/移除币种
✅ **自动文件加载** - 自动从筛选结果文件加载币种列表
✅ **实时统计** - 显示系统状态、连接数、内存使用等

## 使用方法

### 1. 自动加载筛选结果

系统会自动查找并加载以下文件中的币种列表：

```bash
# 运行监控系统（自动加载最新筛选结果）
node tradingVolume.js
```

系统会按以下优先级自动加载：
1. `low_market_cap_trading_pairs.js` - 简洁的币种数组
2. `filtered_trading_pairs_by_market_cap.json` - 详细筛选结果
3. `trading_pairs.json` - 原始交易对列表

### 2. 指定文件加载

```bash
# 从指定文件加载币种列表
node tradingVolume.js path/to/your/symbols.js
node tradingVolume.js path/to/your/symbols.json
```

### 3. 支持的文件格式

#### JavaScript数组格式
```javascript
// low_market_cap_trading_pairs.js
const lowMarketCapTradingPairs = [
    'COINUSDT',
    'TOKENUSDT',
    'CRYPTOUSDT',
    // ... 更多交易对
];

module.exports = lowMarketCapTradingPairs;
```

#### JSON格式
```json
{
    "symbols": ["COINUSDT", "TOKENUSDT", "CRYPTOUSDT"],
    "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### 详细筛选结果格式
```json
{
    "filteredTradingPairs": [
        {
            "tradingPair": "COINUSDT",
            "marketCap": 100000000,
            "currentPrice": 1.23
        }
    ]
}
```

## 系统优化特性

### 连接池管理
- **最大并发连接数**: 100个（可调整）
- **连接队列**: 自动排队等待连接
- **智能重连**: 连接断开时自动重连

### 内存优化
- **定期清理**: 每5分钟清理过期数据
- **滑动窗口**: 只保留最新的30根K线数据
- **垃圾回收**: 自动触发垃圾回收

### 性能监控
```
📊 系统状态: 监控500个币种 | 活跃连接100/100 | 队列0 | 内存256MB
```

## 配置参数

在 `tradingVolume.js` 中可以调整以下参数：

```javascript
// 连接池配置
this.maxConnections = 100; // 最大并发连接数

// 清理配置
const inactiveThreshold = 5 * 60 * 1000; // 5分钟无活动清理
const maxSymbols = 1000; // 最大监控币种数

// 内存优化配置
CONFIG.historyLimit = 30; // 历史K线数量限制
```

## 使用建议

### 1. 系统资源要求
- **内存**: 建议8GB+ RAM
- **CPU**: 建议4核+ CPU
- **网络**: 稳定的网络连接

### 2. 监控币种数量
- **推荐**: 500-800个币种
- **最大**: 1000个币种
- **性能**: 币种数量越多，系统负载越大

### 3. 定期维护
- 定期重启系统以清理内存
- 监控系统资源使用情况
- 及时更新币种列表

## 故障排除

### 1. 连接数超限
```
⏳ BTCUSDT 加入连接队列 (队列长度: 50)
```
- 系统会自动排队等待连接
- 可以增加 `maxConnections` 参数

### 2. 内存使用过高
```
📊 系统状态: 监控500个币种 | 活跃连接100/100 | 队列0 | 内存512MB
```
- 系统会自动清理过期数据
- 可以重启系统释放内存

### 3. 币种加载失败
```
❌ 文件不存在: symbols.js
⚠️ 未能从文件加载币种，使用默认币种列表
```
- 检查文件路径是否正确
- 确保文件格式正确

## 示例输出

```
🚀 启动多币种K线监控系统...
📁 自动发现币种文件: low_market_cap_trading_pairs.js
✅ 成功加载 500 个币种
🎯 准备监控 500 个币种
🔄 批量添加 500 个币种...
✅ 批量添加完成，成功添加 500 个币种
🔄 开始处理连接队列，共 400 个待连接币种...
🔗 连接队列中的币种: BTCUSDT
🔗 连接队列中的币种: ETHUSDT
...
✅ 所有币种连接完成
📊 系统状态: 监控500个币种 | 活跃连接100/100 | 队列0 | 内存256MB
``` 