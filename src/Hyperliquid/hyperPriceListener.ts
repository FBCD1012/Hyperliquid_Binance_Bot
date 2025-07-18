// //构建真正的订单操作理解
// const { Hyperliquid } = require('hyperliquid');
// const { SocksProxyAgent } = require('socks-proxy-agent');
// //sdk的错误案例操作，注意源代码的阅读哈
// async function checkSupportedAssets() {
//   const sdk = new Hyperliquid({
//     enableWs: false,
//     privateKey: process.env.HL_PROVIDER_PRIVATE_KEY_0,
//     testnet: true,
//     walletAddress: process.env.HL_PROVIDER_PRIVATE_KEY_0,
//   });

//   // 先连接 WebSocket
//   await sdk.connect();

//   // 再进行订阅
//   sdk.subscriptions.subscribeToAllMids(data => {
//     console.log("BTC-PERP 实时 mid price:", data['BTC-PERP']);
//   });
// }

// checkSupportedAssets();