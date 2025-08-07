var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
//构建真正的订单操作理解
var Hyperliquid = require('hyperliquid').Hyperliquid;
var sdk = new Hyperliquid({
    enableWs: false,
    privateKey: process.env.HL_PROVIDER_PRIVATE_KEY_0,
    testnet: true,
    walletAddress: process.env.HL_PROVIDER_WALLET_0,
});
function checkSupportedAssets() {
    return __awaiter(this, void 0, void 0, function () {
        var mids, assets, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, sdk.info.getAllMids()];
                case 1:
                    mids = _a.sent();
                    console.log('支持的合约:', Object.keys(mids));
                    return [4 /*yield*/, sdk.info.getAllAssets()];
                case 2:
                    assets = _a.sent();
                    console.log('所有资产:', assets);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('查询资产失败:', error_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
checkSupportedAssets();
function placeOrderExample() {
    return __awaiter(this, void 0, void 0, function () {
        var orderParams, orderResponse, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    orderParams = {
                        coin: 'BTC-PERP',
                        is_buy: true,
                        sz: '0.001',
                        limit_px: '118421',
                        order_type: { limit: { tif: 'Gtc' } }, // 立即成交或取消
                        reduce_only: false,
                    };
                    console.log('订单参数:', JSON.stringify(orderParams, null, 2));
                    return [4 /*yield*/, sdk.exchange.placeOrder(orderParams)];
                case 1:
                    orderResponse = _a.sent();
                    console.log('下单成功:', orderResponse);
                    return [3 /*break*/, 3];
                case 2:
                    error_2 = _a.sent();
                    console.error('操作失败:', error_2.message);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
placeOrderExample();
//构建真正的订单操作理解
function closePosition() {
    return __awaiter(this, void 0, void 0, function () {
        var sdk, state, closeResponse, newState, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sdk = new Hyperliquid({
                        enableWs: false,
                        privateKey: process.env.HL_PROVIDER_PRIVATE_KEY_0,
                        testnet: true,
                        walletAddress: process.env.REALL_WALLET,
                    });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    return [4 /*yield*/, sdk.info.perpetuals.getClearinghouseState(process.env.MY_WALLET)];
                case 2:
                    state = _a.sent();
                    console.log('当前持仓:', state.assetPositions);
                    return [4 /*yield*/, sdk.custom.marketClose('BTC-PERP')];
                case 3:
                    closeResponse = _a.sent();
                    console.log('平仓成功:', closeResponse);
                    return [4 /*yield*/, sdk.info.perpetuals.getClearinghouseState(process.env.MY_WALLET)];
                case 4:
                    newState = _a.sent();
                    console.log('平仓后持仓:', newState.assetPositions);
                    return [3 /*break*/, 6];
                case 5:
                    error_3 = _a.sent();
                    console.error('平仓失败:', error_3.message);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
closePosition();
