const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const http = require('http');
const net = require('net'); // Added for proxy check

// 代理配置
// 请根据您的实际代理设置修改以下配置
const PROXY_CONFIG = {
    host: '127.0.0.1',  // 代理服务器地址 (localhost)
    port: 7897,         // 代理服务器端口 (常见端口: 7890, 1080, 8080)
    protocol: 'http'    // 代理协议 (http, https, socks5)
};

// 设置环境变量代理（更可靠的方式）
process.env.HTTP_PROXY = `http://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
process.env.HTTPS_PROXY = `http://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
console.log('🌐 设置环境变量代理:', process.env.HTTP_PROXY);

// 常见代理配置示例:
// Clash: host: '127.0.0.1', port: 7890
// V2Ray: host: '127.0.0.1', port: 1080
// Shadowsocks: host: '127.0.0.1', port: 1080
// 企业代理: host: 'proxy.company.com', port: 8080

// 检测代理是否可用
function checkProxy() {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        socket.setTimeout(5000); // 5秒超时
        
        socket.on('connect', () => {
            socket.destroy();
            console.log('✅ 代理连接成功');
            resolve(true);
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            console.log('❌ 代理连接超时');
            resolve(false);
        });
        
        socket.on('error', () => {
            console.log('❌ 代理连接失败');
            resolve(false);
        });
        
        socket.connect(PROXY_CONFIG.port, PROXY_CONFIG.host);
    });
}

// 创建代理代理
function createProxyAgent() {
    console.log(`🔧 创建代理代理: ${PROXY_CONFIG.protocol}://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
    
    if (PROXY_CONFIG.protocol === 'https') {
        return new https.Agent({
            proxy: {
                host: PROXY_CONFIG.host,
                port: PROXY_CONFIG.port
            },
            timeout: 10000, // 10秒超时
            keepAlive: true
        });
    } else {
        return new http.Agent({
            proxy: {
                host: PROXY_CONFIG.host,
                port: PROXY_CONFIG.port
            },
            timeout: 10000, // 10秒超时
            keepAlive: true
        });
    }
}

// Google Sheets API 配置
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// 示例电子表格ID（需要替换为你的实际ID）
const SPREADSHEET_ID = '14HTtcqCpSF0NcZR8uJt7ouO4byM_Tbn4iZcvq-RbnW8'; // 你的实际电子表格ID

// 创建认证客户端
async function createAuthClient() {
    try {
        // 检查是否存在凭据文件
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.log('❌ 凭据文件不存在！');
            console.log('💡 请按照以下步骤设置：');
            console.log('1. 访问 https://console.cloud.google.com/');
            console.log('2. 创建新项目或选择现有项目');
            console.log('3. 启用 Google Sheets API');
            console.log('4. 创建服务账号并下载凭据文件');
            console.log('5. 将凭据文件重命名为 credentials.json 并放在此目录');
            return null;
        }

        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            redirect_uris[0]
        );

        // 检查是否存在令牌文件
        if (fs.existsSync(TOKEN_PATH)) {
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
            oAuth2Client.setCredentials(token);
            console.log('✅ 使用现有令牌进行认证');
            return oAuth2Client;
        } else {
            console.log('🔑 需要获取新的访问令牌');
            return await getNewToken(oAuth2Client);
        }
    } catch (error) {
        console.error('❌ 创建认证客户端失败:', error.message);
        return null;
    }
}

// 获取新的访问令牌
async function getNewToken(oAuth2Client) {
    try {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });

        console.log('🔗 请在浏览器中访问以下URL进行授权:');
        console.log(authUrl);
        console.log('\n💡 授权后，将获得的授权码粘贴到控制台');

        // 创建readline接口来读取用户输入
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve, reject) => {
            rl.question('请输入授权码: ', async (code) => {
                rl.close();
                
                try {
                    console.log('🔄 正在获取令牌...');
                    
                    // 先尝试不使用代理，设置超时
                    let tokens;
                    try {
                        console.log('📡 尝试直连获取令牌...');
                        
                        // 创建超时Promise
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('直连请求超时')), 10000); // 10秒超时
                        });
                        
                        const tokenPromise = oAuth2Client.getToken(code);
                        const response = await Promise.race([tokenPromise, timeoutPromise]);
                        
                        // 处理响应
                        if (response && response.tokens) {
                            tokens = response.tokens;
                        } else if (response && response.access_token) {
                            // 如果响应直接包含访问令牌
                            tokens = response;
                        } else {
                            throw new Error('直连响应格式错误');
                        }
                        
                        console.log('✅ 直连获取令牌成功');
                    } catch (directError) {
                        console.log('⚠️  直连失败，尝试使用代理...');
                        console.log('   直连错误:', directError.message);
                        
                        // 如果直连失败，尝试使用代理
                        try {
                            console.log('🔄 使用代理获取令牌...');
                            const proxyAgent = createProxyAgent();
                            
                            console.log('🔍 发送令牌请求...');
                            const response = await oAuth2Client.getToken(code, {
                                httpAgent: proxyAgent,
                                httpsAgent: proxyAgent
                            });
                            
                            console.log('📥 收到代理响应:');
                            console.log('   - 响应类型:', typeof response);
                            console.log('   - 响应内容:', JSON.stringify(response, null, 2));
                            console.log('   - 响应键:', response ? Object.keys(response) : 'undefined');
                            
                            // 处理代理响应
                            if (response && response.tokens) {
                                console.log('✅ 找到 response.tokens');
                                tokens = response.tokens;
                            } else if (response && response.access_token) {
                                console.log('✅ 找到 response.access_token');
                                tokens = response;
                            } else if (response && typeof response === 'object') {
                                console.log('⚠️  响应是对象但格式不标准，尝试直接使用');
                                tokens = response;
                            } else {
                                console.error('❌ 代理响应格式无法识别');
                                console.error('   响应:', response);
                                throw new Error(`代理响应格式错误: ${JSON.stringify(response)}`);
                            }
                            
                            console.log('✅ 代理获取令牌成功');
                        } catch (proxyError) {
                            console.error('❌ 代理获取令牌也失败:', proxyError.message);
                            console.error('   错误详情:', proxyError);
                            throw new Error(`直连和代理都失败: 直连错误=${directError.message}, 代理错误=${proxyError.message}`);
                        }
                    }
                    
                    // 检查令牌
                    if (tokens && (tokens.access_token || tokens.tokens)) {
                        console.log('🔍 令牌信息:');
                        console.log('   - 访问令牌:', tokens.access_token ? '✅ 存在' : '❌ 缺失');
                        console.log('   - 刷新令牌:', tokens.refresh_token ? '✅ 存在' : '❌ 缺失');
                        console.log('   - 令牌类型:', tokens.token_type || '未知');
                        
                        oAuth2Client.setCredentials(tokens);
                        
                        // 保存令牌到文件
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        console.log('✅ 令牌获取成功并已保存');
                        
                        resolve(oAuth2Client);
                    } else {
                        console.error('❌ 令牌格式错误:', tokens);
                        console.error('   令牌类型:', typeof tokens);
                        console.error('   令牌内容:', JSON.stringify(tokens, null, 2));
                        reject(new Error('令牌格式错误'));
                    }
                } catch (error) {
                    console.error('❌ 获取令牌失败:', error.message);
                    console.error('   错误详情:', error);
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error('❌ 获取新令牌失败:', error.message);
        return null;
    }
}

// 创建Google Sheets服务
function createSheetsService(auth) {
    const proxyAgent = createProxyAgent();
    return google.sheets({ 
        version: 'v4', 
        auth,
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    });
}

// 读取电子表格数据
async function readSpreadsheet(sheetsService, spreadsheetId, range = 'Sheet1!A1:D10') {
    try {
        console.log(`📖 正在读取电子表格: ${range}`);
        
        const response = await sheetsService.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        
        if (!rows || rows.length === 0) {
            console.log('📭 没有找到数据');
            return [];
        }

        console.log(`✅ 成功读取 ${rows.length} 行数据:`);
        rows.forEach((row, index) => {
            console.log(`   ${index + 1}: [${row.join(', ')}]`);
        });

        return rows;
    } catch (error) {
        console.error('❌ 读取电子表格失败:', error.message);
        return null;
    }
}

// 写入数据到电子表格
async function writeToSpreadsheet(sheetsService, spreadsheetId, range, values) {
    try {
        console.log(`✍️  正在写入数据到: ${range}`);
        
        const response = await sheetsService.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            resource: {
                values: values
            }
        });

        console.log(`✅ 成功写入数据！更新了 ${response.data.updatedCells} 个单元格`);
        return true;
    } catch (error) {
        console.error('❌ 写入数据失败:', error.message);
        return false;
    }
}

// 追加数据到电子表格
async function appendToSpreadsheet(sheetsService, spreadsheetId, range, values) {
    try {
        console.log(`➕ 正在追加数据到: ${range}`);
        
        const response = await sheetsService.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: values
            }
        });

        console.log(`✅ 成功追加数据！更新了 ${response.data.updates.updatedCells} 个单元格`);
        return true;
    } catch (error) {
        console.error('❌ 追加数据失败:', error.message);
        return false;
    }
}

// 获取电子表格元数据
async function getSpreadsheetInfo(sheetsService, spreadsheetId) {
    try {
        console.log('📋 正在获取电子表格信息...');
        
        const response = await sheetsService.spreadsheets.get({
            spreadsheetId,
        });

        const spreadsheet = response.data;
        
        console.log(`\n📊 电子表格信息:`);
        console.log(`   📝 标题: ${spreadsheet.properties.title}`);
        console.log(`   📅 创建时间: ${new Date(spreadsheet.properties.createdTime).toLocaleString('zh-CN')}`);
        console.log(`   📅 修改时间: ${new Date(spreadsheet.properties.modifiedTime).toLocaleString('zh-CN')}`);
        console.log(`   📄 工作表数量: ${spreadsheet.sheets.length}`);
        
        console.log(`\n📋 工作表列表:`);
        spreadsheet.sheets.forEach((sheet, index) => {
            console.log(`   ${index + 1}. ${sheet.properties.title} (ID: ${sheet.properties.sheetId})`);
        });

        return spreadsheet;
    } catch (error) {
        console.error('❌ 获取电子表格信息失败:', error.message);
        return null;
    }
}

// 创建新的电子表格
async function createNewSpreadsheet(sheetsService, title = 'Google Sheets Demo') {
    try {
        console.log(`🆕 正在创建新的电子表格: ${title}`);
        
        const response = await sheetsService.spreadsheets.create({
            resource: {
                properties: {
                    title: title
                },
                sheets: [
                    {
                        properties: {
                            title: 'Sheet1'
                        }
                    }
                ]
            }
        });

        const spreadsheet = response.data;
        console.log(`✅ 成功创建电子表格！`);
        console.log(`   📝 标题: ${spreadsheet.properties.title}`);
        console.log(`   🔗 链接: ${spreadsheet.spreadsheetUrl}`);
        console.log(`   🆔 ID: ${spreadsheet.spreadsheetId}`);
        
        return spreadsheet;
    } catch (error) {
        console.error('❌ 创建电子表格失败:', error.message);
        return null;
    }
}

// 演示函数
async function demo() {
    console.log('🚀 Google Sheets API 演示程序启动...\n');

    // 1. 创建认证客户端
    const auth = await createAuthClient();
    if (!auth) {
        console.log('\n❌ 认证失败，程序退出');
        return;
    }

    // 2. 创建Sheets服务
    const sheetsService = createSheetsService(auth);
    console.log('✅ Google Sheets 服务创建成功\n');

    // 3. 创建新的电子表格（如果没有指定ID）
    let spreadsheetId = SPREADSHEET_ID;
    if (spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') {
        console.log('📝 未指定电子表格ID，创建新的电子表格...');
        const newSpreadsheet = await createNewSpreadsheet(sheetsService, 'Trading Bot Demo');
        if (newSpreadsheet) {
            spreadsheetId = newSpreadsheet.spreadsheetId;
            console.log(`\n💡 请将以下ID复制到代码中的 SPREADSHEET_ID 变量:`);
            console.log(`   SPREADSHEET_ID = '${spreadsheetId}'`);
        } else {
            console.log('❌ 创建电子表格失败，程序退出');
            return;
        }
    }

    // 4. 获取电子表格信息
    console.log('\n' + '='.repeat(50));
    const spreadsheetInfo = await getSpreadsheetInfo(sheetsService, spreadsheetId);
    
    // 获取第一个工作表的名称
    let sheetName = '工作表1'; // 默认名称
    if (spreadsheetInfo && spreadsheetInfo.sheets && spreadsheetInfo.sheets.length > 0) {
        sheetName = spreadsheetInfo.sheets[0].properties.title;
        console.log(`📋 使用工作表: ${sheetName}`);
    }

    // 5. 写入示例数据
    console.log('\n' + '='.repeat(50));
    const sampleData = [
        ['时间', '币种', '价格', '成交量', '状态'],
        [new Date().toLocaleString('zh-CN'), 'BTCUSDT', '45000.00', '1000.5', '监控中'],
        [new Date().toLocaleString('zh-CN'), 'ETHUSDT', '3200.00', '500.2', '监控中'],
        [new Date().toLocaleString('zh-CN'), 'SOLUSDT', '150.00', '200.8', '监控中']
    ];

    console.log('📝 写入示例数据...');
    // 使用动态获取的工作表名称
    await writeToSpreadsheet(sheetsService, spreadsheetId, `${sheetName}!A1:E4`, sampleData);

    // 6. 读取数据验证
    console.log('\n' + '='.repeat(50));
    console.log('🔍 验证写入的数据...');
    await readSpreadsheet(sheetsService, spreadsheetId, `${sheetName}!A1:E4`);

    // 7. 追加新数据
    console.log('\n' + '='.repeat(50));
    const newRow = [
        new Date().toLocaleString('zh-CN'),
        'ADAUSDT',
        '0.85',
        '150.3',
        '新增'
    ];

    console.log('➕ 追加新数据行...');
    await appendToSpreadsheet(sheetsService, spreadsheetId, `${sheetName}!A:E`, [newRow]);

    // 8. 再次读取验证
    console.log('\n' + '='.repeat(50));
    console.log('🔍 验证追加后的数据...');
    await readSpreadsheet(sheetsService, spreadsheetId, `${sheetName}!A1:E5`);

    console.log('\n' + '='.repeat(50));
    console.log('🎉 演示完成！');
    console.log(`💡 你可以在浏览器中打开电子表格查看结果:`);
    console.log(`   https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}

// 主函数
async function main() {
    try {
        console.log('🔍 检测代理连接...');
        const proxyAvailable = await checkProxy();
        
        if (!proxyAvailable) {
            console.log('⚠️  代理连接失败，将使用直连模式');
            console.log('💡 如果遇到网络问题，请检查代理配置');
        }
        
        console.log('\n' + '='.repeat(50));
        await demo();
    } catch (error) {
        console.error('❌ 程序执行失败:', error.message);
    }
}

// 程序退出处理
process.on('SIGINT', () => {
    console.log('\n👋 程序正在退出...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的Promise拒绝:', reason);
});

// 启动程序
main();
