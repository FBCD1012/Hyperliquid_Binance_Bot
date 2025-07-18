// //const { Hyperliquid } = require('hyperliquid');

// //核心操作sdk理解
// const sdk = new Hyperliquid({
//     enableWs: false,
//     privateKey: process.env.HL_PROVIDER_PRIVATE_KEY,
//     testnet: false, // 测试网为 true，主网为 false
//     walletAddress: process.env.HL_PROVIDER_WALLET
// });

// //注意此处一定是毫秒级别进行的操作
// const now = Date.now(); // 毫秒
// const eightHoursAgo = now - 8 * 60 * 60 * 1000; // 8小时

// //这里获取八小时其实就是通过相关的操作进行的资费操作（八个小时进行的就是返回八条进行）
// sdk.info.perpetuals.getFundingHistory('ATOM-PERP', eightHoursAgo, now).then(history => {
//   console.log('ATOM-PERP 过去8小时资金费率历史:', history);
// }).catch(err => {
//   console.error('获取资金费率历史出错:', err);
// });
// //最新的资金费率，就只需要看第一条就行了
// sdk.info.perpetuals.getFundingHistory('ATOM-PERP', eightHoursAgo, now).then(history => {
//     const latest = history[history.length - 1];
//     console.log('最新资金费率:', latest);
//   });