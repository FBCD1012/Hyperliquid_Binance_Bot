# Google Sheets API 演示程序

这是一个完整的Google Sheets API演示程序，展示了如何读取、写入和更新Google Sheets。

## 🚀 功能特性

- ✅ **认证管理**：OAuth2.0认证流程
- 📖 **读取数据**：从指定范围读取数据
- ✍️ **写入数据**：更新指定范围的数据
- ➕ **追加数据**：在末尾添加新行
- 📋 **元数据获取**：获取电子表格信息
- 🆕 **创建表格**：创建新的电子表格
- 🔍 **数据验证**：实时验证操作结果

## 📋 前置要求

1. **Node.js** 16.0.0 或更高版本
2. **Google Cloud Console** 账户
3. **Google Sheets API** 已启用

## 🔧 安装步骤

### 1. 安装依赖

```bash
cd src/Google
npm install
```

### 2. 设置Google Cloud凭据

#### 步骤1：访问Google Cloud Console
- 打开 [Google Cloud Console](https://console.cloud.google.com/)
- 创建新项目或选择现有项目

#### 步骤2：启用Google Sheets API
- 在左侧菜单中选择 "API和服务" > "库"
- 搜索 "Google Sheets API"
- 点击启用

#### 步骤3：创建凭据
- 在左侧菜单中选择 "API和服务" > "凭据"
- 点击 "创建凭据" > "OAuth 2.0 客户端ID"
- 选择应用类型：**桌面应用**
- 输入名称（如：Google Sheets Demo）
- 点击创建

#### 步骤4：下载凭据文件
- 下载JSON格式的凭据文件
- 重命名为 `credentials.json`
- 放置在 `src/Google/` 目录下

### 3. 配置电子表格ID

在 `googleSheetsDemo.js` 文件中，将以下行：
```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
```

替换为你的实际电子表格ID，或者留空让程序自动创建新的电子表格。

## 🎯 使用方法

### 运行演示程序

```bash
npm start
```

或者

```bash
node googleSheetsDemo.js
```

### 首次运行流程

1. **程序启动**：显示设置说明
2. **认证检查**：验证凭据文件
3. **创建表格**：如果没有指定ID，自动创建新表格
4. **写入数据**：写入示例交易数据
5. **数据验证**：读取并显示结果
6. **追加数据**：添加新的数据行
7. **最终验证**：确认所有操作成功

## 📊 示例数据结构

程序会创建包含以下列的示例数据：

| 时间 | 币种 | 价格 | 成交量 | 状态 |
|------|------|------|--------|------|
| 2024-01-01 12:00:00 | BTCUSDT | 45000.00 | 1000.5 | 监控中 |
| 2024-01-01 12:00:00 | ETHUSDT | 3200.00 | 500.2 | 监控中 |
| 2024-01-01 12:00:00 | SOLUSDT | 150.00 | 200.8 | 监控中 |

## 🔐 认证说明

### OAuth2.0 流程

1. **凭据文件**：`credentials.json` 包含客户端ID和密钥
2. **访问令牌**：首次运行需要浏览器授权
3. **令牌缓存**：授权后的令牌保存在 `token.json` 中

### 生产环境建议

- 使用**服务账号**认证替代OAuth2.0
- 设置适当的**API配额限制**
- 实现**令牌刷新**机制

## 📁 文件结构

```
src/Google/
├── googleSheetsDemo.js    # 主程序文件
├── package.json           # 依赖配置
├── README.md             # 说明文档
├── credentials.json      # Google Cloud凭据（需要手动添加）
└── token.json           # 访问令牌缓存（自动生成）
```

## 🚨 常见问题

### Q: 凭据文件不存在错误
**A:** 确保已下载并重命名凭据文件为 `credentials.json`

### Q: 权限不足错误
**A:** 确保Google Sheets API已启用，且凭据有足够权限

### Q: 电子表格访问被拒绝
**A:** 确保电子表格已共享给你的Google账户

### Q: API配额超限
**A:** 在Google Cloud Console中检查API使用量，适当调整配额

## 🔗 相关链接

- [Google Sheets API 官方文档](https://developers.google.com/sheets/api)
- [Google Cloud Console](https://console.cloud.google.com/)
- [OAuth 2.0 认证指南](https://developers.google.com/identity/protocols/oauth2)
- [Node.js Google APIs 客户端](https://github.com/googleapis/google-api-nodejs-client)

## 📝 许可证

MIT License - 详见 LICENSE 文件

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个演示程序！
