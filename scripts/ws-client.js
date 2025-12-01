/**
 * WebSocket client để kết nối với IronForge RPC endpoint
 * Nhận và xử lý messages từ WebSocket connection
 * 
 * Run: node scripts/ws-client.js
 */

const WebSocket = require('ws');

// WebSocket URL với API key
const WS_URL = 'wss://rpc.ironforge.network/mainnet?apiKey=01J4NJDYJXSGJYE3AN6VXEB5VR';

// Headers từ curl command
const WS_OPTIONS = {
  headers: {
    'Origin': 'https://ore.supply',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-GPC': '1'
  }
};

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Tạo WebSocket connection và xử lý messages
 */
function connectWebSocket() {
  console.log(`🔌 Đang kết nối đến ${WS_URL}...`);
  
  const ws = new WebSocket(WS_URL, WS_OPTIONS);

  // Khi kết nối thành công
  ws.on('open', () => {
    console.log('✅ Đã kết nối WebSocket thành công!');
    reconnectAttempts = 0; // Reset reconnect counter
    
    // Có thể gửi subscription message ở đây nếu cần
    // Ví dụ: subscribe to slot updates
    // ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe' }));
  });

  // Nhận messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('\n📨 Nhận được message:');
      console.log(JSON.stringify(message, null, 2));
      
      // Xử lý message ở đây
      handleMessage(message);
    } catch (error) {
      // Nếu không phải JSON, in ra raw data
      console.log('\n📨 Nhận được raw message:');
      console.log(data.toString());
    }
  });

  // Xử lý lỗi
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });

  // Khi connection đóng
  ws.on('close', (code, reason) => {
    console.log(`\n🔌 Connection đã đóng. Code: ${code}, Reason: ${reason || 'N/A'}`);
    
    // Tự động reconnect nếu chưa vượt quá số lần thử
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`🔄 Đang thử kết nối lại... (Lần ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(() => {
        connectWebSocket();
      }, RECONNECT_DELAY);
    } else {
      console.error('❌ Đã vượt quá số lần thử kết nối lại. Dừng chương trình.');
      process.exit(1);
    }
  });

  // Xử lý ping/pong để giữ connection alive
  ws.on('ping', () => {
    console.log('🏓 Nhận ping, gửi pong...');
    ws.pong();
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Đang đóng connection...');
    ws.close();
    process.exit(0);
  });

  return ws;
}

/**
 * Xử lý message nhận được từ WebSocket
 * @param {Object} message - Message object
 */
function handleMessage(message) {
  // Tùy chỉnh logic xử lý message ở đây
  // Ví dụ: filter theo type, save to database, etc.
  
  if (message.method) {
    console.log(`   Method: ${message.method}`);
  }
  
  if (message.params) {
    console.log(`   Params: ${JSON.stringify(message.params)}`);
  }
  
  if (message.result) {
    console.log(`   Result: ${JSON.stringify(message.result)}`);
  }
}

// Bắt đầu kết nối
console.log('🚀 Khởi động WebSocket client...\n');
const ws = connectWebSocket();













