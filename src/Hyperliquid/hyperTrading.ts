//构建真正的订单操作理解
const { Hyperliquid } = require('hyperliquid');
const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '0xd5c287f46747210fbe2af3320cd441f7991b8ee4e57887b37ff295b263c47b22',
    testnet: true,
    walletAddress: '0xAD5faB0778F2db54f6B78d45FFcFfef3381d09bF',
});
async function checkSupportedAssets() {
  try {
    // 获取所有支持的合约
    const mids = await sdk.info.getAllMids();
    console.log('支持的合约:', Object.keys(mids));
    
    // 获取所有资产
    const assets = await sdk.info.getAllAssets();
    console.log('所有资产:', assets);

  } catch (error) {
    console.error('查询资产失败:', error);
  }
}

checkSupportedAssets();

async function placeOrderExample() {
  //限价订单结束了，核心是此处进行的相关操作
  try {
    const orderParams = {
        coin: 'BTC-PERP',
        is_buy: true,
        sz: '0.001',
        limit_px: '118421',
        order_type: { limit: { tif: 'Gtc' } }, // 立即成交或取消
        reduce_only: false,
      };

    console.log('订单参数:', JSON.stringify(orderParams, null, 2));

    const orderResponse = await sdk.exchange.placeOrder(orderParams);
    console.log('下单成功:', orderResponse);

  } catch (error) {
    console.error('操作失败:', error.message);
  }
}

placeOrderExample();
//构建真正的订单操作理解
async function closePosition() {
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: '0xd5c287f46747210fbe2af3320cd441f7991b8ee4e57887b37ff295b263c47b22',
    testnet: true,
    walletAddress: '0x071b7Ec2C0a55ADc03E44A42Ee09A5066e3b7676',
  });

  try {
    // 1. 先查看当前持仓
    const state = await sdk.info.perpetuals.getClearinghouseState('0x071b7Ec2C0a55ADc03E44A42Ee09A5066e3b7676');
    console.log('当前持仓:', state.assetPositions);

    // 2. 平掉 BTC-PERP 的全部持仓
    const closeResponse = await sdk.custom.marketClose('BTC-PERP');
    console.log('平仓成功:', closeResponse);

    // 3. 再次查看持仓（确认已平仓）
    const newState = await sdk.info.perpetuals.getClearinghouseState('0x071b7Ec2C0a55ADc03E44A42Ee09A5066e3b7676');
    console.log('平仓后持仓:', newState.assetPositions);

  } catch (error) {
    console.error('平仓失败:', error.message);
  }
}
closePosition();