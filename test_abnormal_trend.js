// 测试异常趋势分析功能
// 直接复制KlineManager类来避免导入问题

// 单个币种的K线管理器
class KlineManager {
    constructor(maxLength = 30, symbol = '') {
        this.symbol = symbol;
        this.klines = [];
        this.maxLength = maxLength;
        this.isInitialized = false;
        this.lastUpdateTime = 0;
        
        // 新增：趋势分析相关属性
        this.volumeHistory = []; // 记录最近10根K线的成交量变化
        this.alertHistory = []; // 记录最近5次警报情况
        this.consecutiveAbnormalCount = 0; // 连续异常次数
        this.lastAbnormalType = null; // 上次异常类型
        this.trendStrength = 0; // 趋势强度 (0-100)
        this.abnormalHistory = []; // 异常历史记录
    }

    // 重新设计：异常趋势分析 - 只关注放量异常
    checkConsecutiveAbnormal(volumeLevel, percentageChange) {
        const currentTime = Date.now();
        const isAbnormal = Math.abs(percentageChange) > 30;
        const isSurge = percentageChange > 30; // 只关注放量异常
        const currentType = percentageChange > 0 ? 'surge' : 'shrink';
        const abnormalIntensity = Math.abs(percentageChange);
        
        // 只记录放量异常历史
        if (isAbnormal && isSurge) {
            this.abnormalHistory = this.abnormalHistory || [];
            this.abnormalHistory.push({
                timestamp: currentTime,
                type: currentType,
                intensity: abnormalIntensity,
                percentageChange: percentageChange,
                volumeLevel: volumeLevel
            });
            
            // 只保留最近10次异常记录
            if (this.abnormalHistory.length > 10) {
                this.abnormalHistory.shift();
            }
        }
        
        // 分析异常趋势（只针对放量异常）
        const trendAnalysis = this.analyzeAbnormalTrend();
        
        // 更新连续异常计数（只计算放量异常）
        if (isAbnormal && isSurge) {
            if (this.lastAbnormalType === 'surge') {
                this.consecutiveAbnormalCount++;
            } else {
                this.consecutiveAbnormalCount = 1;
                this.lastAbnormalType = 'surge';
            }
        } else {
            // 如果是缩量异常，重置计数
            this.consecutiveAbnormalCount = 0;
            this.lastAbnormalType = null;
        }

        return {
            consecutiveCount: this.consecutiveAbnormalCount,
            type: this.lastAbnormalType,
            isConsecutive: this.consecutiveAbnormalCount >= 2,
            trendAnalysis: trendAnalysis,
            currentIntensity: abnormalIntensity,
            abnormalHistory: this.abnormalHistory || [],
            isSurge: isSurge // 新增：标识是否为放量异常
        };
    }

    // 新增：异常趋势分析
    analyzeAbnormalTrend() {
        if (!this.abnormalHistory || this.abnormalHistory.length < 2) {
            return {
                trend: 'insufficient',
                strength: 0,
                pattern: 'none',
                reason: '异常历史数据不足',
                details: {
                    abnormalCount: this.abnormalHistory ? this.abnormalHistory.length : 0,
                    requiredCount: 2
                }
            };
        }

        const recentAbnormals = this.abnormalHistory.slice(-5); // 最近5次异常
        const currentTime = Date.now();
        
        // 1. 异常强度趋势分析
        const intensityTrend = this.analyzeIntensityTrend(recentAbnormals);
        
        // 2. 异常频率分析
        const frequencyAnalysis = this.analyzeAbnormalFrequency(recentAbnormals, currentTime);
        
        // 3. 异常模式识别
        const patternAnalysis = this.analyzeAbnormalPattern(recentAbnormals);
        
        // 4. 时间序列分析
        const timeSeriesAnalysis = this.analyzeTimeSeries(recentAbnormals);
        
        // 5. 综合趋势判断
        const comprehensiveTrend = this.combineAbnormalTrends(
            intensityTrend, 
            frequencyAnalysis, 
            patternAnalysis, 
            timeSeriesAnalysis
        );
        
        return comprehensiveTrend;
    }

    // 异常强度趋势分析
    analyzeIntensityTrend(abnormals) {
        if (abnormals.length < 2) return { trend: 'insufficient', strength: 0 };
        
        const intensities = abnormals.map(a => a.intensity);
        let increasingCount = 0;
        let decreasingCount = 0;
        let totalChange = 0;
        
        for (let i = 1; i < intensities.length; i++) {
            const change = intensities[i] - intensities[i-1];
            totalChange += change;
            if (change > 0) increasingCount++;
            else if (change < 0) decreasingCount++;
        }
        
        const avgChange = totalChange / (intensities.length - 1);
        const trendStrength = Math.abs(avgChange) / (Math.max(...intensities) * 0.1); // 相对强度
        
        let trend = 'stable';
        if (increasingCount > decreasingCount && trendStrength > 0.3) {
            trend = 'intensifying';
        } else if (decreasingCount > increasingCount && trendStrength > 0.3) {
            trend = 'weakening';
        }
        
        return {
            trend: trend,
            strength: Math.min(trendStrength * 100, 100),
            avgChange: avgChange,
            increasingCount: increasingCount,
            decreasingCount: decreasingCount
        };
    }

    // 异常频率分析
    analyzeAbnormalFrequency(abnormals, currentTime) {
        if (abnormals.length < 2) return { frequency: 'low', score: 0 };
        
        const timeIntervals = [];
        for (let i = 1; i < abnormals.length; i++) {
            const interval = abnormals[i].timestamp - abnormals[i-1].timestamp;
            timeIntervals.push(interval);
        }
        
        const avgInterval = timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length;
        const recentInterval = currentTime - abnormals[abnormals.length - 1].timestamp;
        
        // 频率评分：间隔越短，频率越高
        // 修复：避免除以0，设置最小间隔为1分钟
        const minInterval = Math.max(avgInterval, 60000); // 至少1分钟
        const frequencyScore = Math.max(0, 100 - (minInterval / 60000)); // 基于分钟计算
        
        let frequency = 'low';
        if (frequencyScore > 70) frequency = 'very_high';
        else if (frequencyScore > 50) frequency = 'high';
        else if (frequencyScore > 30) frequency = 'medium';
        
        return {
            frequency: frequency,
            score: frequencyScore,
            avgInterval: avgInterval / 60000, // 转换为分钟
            recentInterval: recentInterval / 60000
        };
    }

    // 异常模式识别
    analyzeAbnormalPattern(abnormals) {
        if (abnormals.length < 3) return { pattern: 'none', confidence: 0 };
        
        const types = abnormals.map(a => a.type);
        const intensities = abnormals.map(a => a.intensity);
        
        // 模式1：连续同类型异常
        let consecutiveSameType = 1;
        for (let i = types.length - 1; i > 0; i--) {
            if (types[i] === types[i-1]) consecutiveSameType++;
            else break;
        }
        
        // 模式2：交替异常
        let alternatingCount = 0;
        for (let i = 1; i < types.length; i++) {
            if (types[i] !== types[i-1]) alternatingCount++;
        }
        
        // 模式3：强度递增/递减
        let intensityPattern = 'stable';
        let intensityConsistency = 0;
        for (let i = 1; i < intensities.length; i++) {
            if (intensities[i] > intensities[i-1]) intensityConsistency++;
            else if (intensities[i] < intensities[i-1]) intensityConsistency--;
        }
        
        if (intensityConsistency > 0) intensityPattern = 'increasing';
        else if (intensityConsistency < 0) intensityPattern = 'decreasing';
        
        // 确定主导模式
        let pattern = 'random';
        let confidence = 0;
        
        if (consecutiveSameType >= 3) {
            pattern = 'consecutive_same';
            confidence = Math.min(consecutiveSameType * 25, 100);
        } else if (alternatingCount >= types.length - 1) {
            pattern = 'alternating';
            confidence = Math.min(alternatingCount * 20, 100);
        } else if (Math.abs(intensityConsistency) >= intensities.length - 1) {
            pattern = intensityPattern;
            confidence = Math.min(Math.abs(intensityConsistency) * 20, 100);
        }
        
        return {
            pattern: pattern,
            confidence: confidence,
            consecutiveSameType: consecutiveSameType,
            alternatingCount: alternatingCount,
            intensityPattern: intensityPattern
        };
    }

    // 时间序列分析
    analyzeTimeSeries(abnormals) {
        if (abnormals.length < 3) return { trend: 'insufficient', volatility: 0 };
        
        const timestamps = abnormals.map(a => a.timestamp);
        const intensities = abnormals.map(a => a.intensity);
        
        // 计算时间间隔的变异系数
        const intervals = [];
        for (let i = 1; i < timestamps.length; i++) {
            intervals.push(timestamps[i] - timestamps[i-1]);
        }
        
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const intervalVariance = intervals.reduce((sum, interval) => {
            return sum + Math.pow(interval - avgInterval, 2);
        }, 0) / intervals.length;
        const intervalStdDev = Math.sqrt(intervalVariance);
        
        // 修复：避免除以0，设置最小平均值
        const minAvgInterval = Math.max(avgInterval, 1000); // 至少1秒
        const intervalCV = intervalStdDev / minAvgInterval; // 变异系数
        
        // 计算强度的时间趋势
        const timeTrend = this.calculateTimeTrend(timestamps, intensities);
        
        return {
            trend: timeTrend.trend,
            volatility: Math.min(intervalCV * 100, 100),
            avgInterval: avgInterval / 60000, // 分钟
            intervalCV: intervalCV,
            timeSlope: timeTrend.slope
        };
    }

    // 计算时间趋势
    calculateTimeTrend(timestamps, values) {
        const n = timestamps.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += timestamps[i];
            sumY += values[i];
            sumXY += timestamps[i] * values[i];
            sumX2 += timestamps[i] * timestamps[i];
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const trend = slope > 0.0001 ? 'increasing' : slope < -0.0001 ? 'decreasing' : 'stable';
        
        return { trend, slope };
    }

    // 综合异常趋势分析
    combineAbnormalTrends(intensityTrend, frequencyAnalysis, patternAnalysis, timeSeriesAnalysis) {
        // 权重分配
        const weights = {
            intensity: 0.35,
            frequency: 0.25,
            pattern: 0.25,
            timeSeries: 0.15
        };
        
        // 修复：处理NaN值
        const intensityScore = isNaN(intensityTrend.strength) ? 0 : intensityTrend.strength;
        const frequencyScore = isNaN(frequencyAnalysis.score) ? 0 : frequencyAnalysis.score;
        const patternScore = isNaN(patternAnalysis.confidence) ? 0 : patternAnalysis.confidence;
        const timeSeriesScore = isNaN(timeSeriesAnalysis.volatility) ? 0 : (100 - timeSeriesAnalysis.volatility);
        
        // 计算综合强度
        const combinedStrength = (
            intensityScore * weights.intensity +
            frequencyScore * weights.frequency +
            patternScore * weights.pattern +
            timeSeriesScore * weights.timeSeries
        );
        
        // 确定主导趋势
        let dominantTrend = 'stable';
        let trendReason = '';
        
        if (intensityTrend.trend === 'intensifying' && combinedStrength > 60) {
            dominantTrend = 'intensifying';
            trendReason = `异常强度递增趋势 (强度:${intensityScore.toFixed(1)}%, 频率:${frequencyAnalysis.frequency})`;
        } else if (intensityTrend.trend === 'weakening' && combinedStrength > 60) {
            dominantTrend = 'weakening';
            trendReason = `异常强度递减趋势 (强度:${intensityScore.toFixed(1)}%, 频率:${frequencyAnalysis.frequency})`;
        } else if (frequencyAnalysis.frequency === 'very_high' && combinedStrength > 50) {
            dominantTrend = 'high_frequency';
            trendReason = `高频异常模式 (频率:${frequencyScore.toFixed(1)}%, 模式:${patternAnalysis.pattern})`;
        } else if (patternAnalysis.pattern !== 'random' && patternScore > 60) {
            dominantTrend = 'patterned';
            trendReason = `规律性异常模式 (模式:${patternAnalysis.pattern}, 置信度:${patternScore.toFixed(1)}%)`;
        } else if (combinedStrength > 40) {
            dominantTrend = 'moderate';
            trendReason = `中等异常趋势 (综合强度:${combinedStrength.toFixed(1)}%)`;
        } else {
            trendReason = `异常趋势不明显 (综合强度:${combinedStrength.toFixed(1)}%)`;
        }
        
        return {
            trend: dominantTrend,
            strength: combinedStrength,
            reason: trendReason,
            details: {
                intensityTrend: intensityTrend,
                frequencyAnalysis: frequencyAnalysis,
                patternAnalysis: patternAnalysis,
                timeSeriesAnalysis: timeSeriesAnalysis,
                weights: weights
            }
        };
    }
}

// 模拟测试数据
function testAbnormalTrendAnalysis() {
    console.log('🧪 开始测试异常趋势分析功能...\n');
    
    const klineManager = new KlineManager(30, 'TESTUSDT');
    
    // 模拟一系列异常数据
    const testCases = [
        // 测试用例1：连续放量异常，强度递增
        {
            name: '连续放量异常 - 强度递增',
            data: [
                { percentageChange: 35, volumeLevel: '明显放量' },
                { percentageChange: 45, volumeLevel: '异常放量' },
                { percentageChange: 60, volumeLevel: '异常放量' },
                { percentageChange: 80, volumeLevel: '异常放量' }
            ]
        },
        
        // 测试用例2：放量缩量混合（只关注放量）
        {
            name: '放量缩量混合 - 只关注放量',
            data: [
                { percentageChange: 40, volumeLevel: '异常放量' },
                { percentageChange: -35, volumeLevel: '异常缩量' },
                { percentageChange: 50, volumeLevel: '异常放量' },
                { percentageChange: -45, volumeLevel: '异常缩量' },
                { percentageChange: 70, volumeLevel: '异常放量' }
            ]
        },
        
        // 测试用例3：高频放量异常
        {
            name: '高频放量异常模式',
            data: [
                { percentageChange: 30, volumeLevel: '明显放量' },
                { percentageChange: 35, volumeLevel: '异常放量' },
                { percentageChange: 40, volumeLevel: '异常放量' },
                { percentageChange: 45, volumeLevel: '异常放量' },
                { percentageChange: 50, volumeLevel: '异常放量' }
            ]
        },
        
        // 测试用例4：放量强度递减
        {
            name: '放量强度递减',
            data: [
                { percentageChange: 80, volumeLevel: '异常放量' },
                { percentageChange: 60, volumeLevel: '异常放量' },
                { percentageChange: 45, volumeLevel: '异常放量' },
                { percentageChange: 35, volumeLevel: '明显放量' }
            ]
        },
        
        // 测试用例5：纯缩量异常（应该被忽略）
        {
            name: '纯缩量异常 - 应该被忽略',
            data: [
                { percentageChange: -40, volumeLevel: '异常缩量' },
                { percentageChange: -50, volumeLevel: '异常缩量' },
                { percentageChange: -60, volumeLevel: '异常缩量' },
                { percentageChange: -70, volumeLevel: '异常缩量' }
            ]
        }
    ];
    
    testCases.forEach((testCase, index) => {
        console.log(`📊 测试用例 ${index + 1}: ${testCase.name}`);
        console.log('─'.repeat(50));
        
        // 重置管理器状态
        klineManager.abnormalHistory = [];
        klineManager.consecutiveAbnormalCount = 0;
        klineManager.lastAbnormalType = null;
        
        // 模拟异常数据输入
        testCase.data.forEach((data, i) => {
            console.log(`  步骤 ${i + 1}: 异常程度 ${data.percentageChange}% (${data.volumeLevel})`);
            
            const result = klineManager.checkConsecutiveAbnormal(data.volumeLevel, data.percentageChange);
            
            console.log(`    连续放量: ${result.consecutiveCount}次`);
            console.log(`    异常类型: ${result.type || '无'}`);
            console.log(`    是否放量: ${result.isSurge ? '是' : '否'}`);
            
            if (result.trendAnalysis && result.trendAnalysis.trend !== 'insufficient') {
                const trend = result.trendAnalysis;
                console.log(`    放量趋势: ${trend.trend} (强度: ${trend.strength.toFixed(1)}%)`);
                console.log(`    趋势原因: ${trend.reason}`);
                
                if (trend.details) {
                    const details = trend.details;
                    console.log(`      强度趋势: ${details.intensityTrend.trend} (${details.intensityTrend.strength.toFixed(1)}%)`);
                    console.log(`      异常频率: ${details.frequencyAnalysis.frequency} (${details.frequencyAnalysis.score.toFixed(1)}%)`);
                    console.log(`      异常模式: ${details.patternAnalysis.pattern} (置信度: ${details.patternAnalysis.confidence.toFixed(1)}%)`);
                    console.log(`      时间序列: ${details.timeSeriesAnalysis.trend} (波动性: ${details.timeSeriesAnalysis.volatility.toFixed(1)}%)`);
                }
            } else {
                console.log(`    放量趋势: 数据不足`);
            }
            console.log('');
        });
        
        console.log('='.repeat(60));
        console.log('');
    });
    
    console.log('✅ 异常趋势分析测试完成！');
}

// 运行测试
testAbnormalTrendAnalysis(); 