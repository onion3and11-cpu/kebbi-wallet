import express from 'express';
import cors from 'cors';
import apiRouter from '../src/routes/api';

async function runApiTests() {
  console.log('\n====================================================');
  console.log(' Starting NUWA Kebbi HTTP API Endpoint Tests');
  console.log('====================================================\n');

  process.env.ROFLOW_TOKEN = 'test_roflow_secret_key_888';

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/v1', apiRouter);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  const server = app.listen(3456);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  const BASE = 'http://127.0.0.1:3456';

  try {
    // 1. Health check
    const healthRes = await fetch(`${BASE}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.status === 'ok', 'GET /api/health returns { status: "ok" }');

    // 2. Robot order creation WITHOUT X-Roflow-Key -> 401 Unauthorized
    const unauthOrderRes = await fetch(`${BASE}/api/v1/robot/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ robot_id: 'KEBBI_ROBOT_001', total_amount: 150 }),
    });
    assert(unauthOrderRes.status === 401, 'POST /api/v1/robot/orders without key returns 401');

    // 3. Robot order creation WITH valid X-Roflow-Key -> 201 Created
    const authOrderRes = await fetch(`${BASE}/api/v1/robot/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Roflow-Key': 'test_roflow_secret_key_888',
      },
      body: JSON.stringify({ robot_id: 'KEBBI_ROBOT_001', total_amount: 150 }),
    });
    const authOrderData = await authOrderRes.json();
    assert(authOrderRes.status === 201 && authOrderData.success === true, 'POST /api/v1/robot/orders with key creates order');
    assert(typeof authOrderData.order_id === 'string', 'Root order_id returned');
    assert(typeof authOrderData.qr_code_image_base64 === 'string', 'Root qr_code_image_base64 returned');
    assert(authOrderData.status === 'PENDING', 'Root status is PENDING');

    const createdOrderId = authOrderData.order_id;
    const createdQrToken = authOrderData.data.qr_code_token;

    // 4. Robot order status query WITH valid X-Roflow-Key -> 200 OK
    const statusRes = await fetch(`${BASE}/api/v1/robot/orders/status?order_id=${createdOrderId}`, {
      headers: { 'X-Roflow-Key': 'test_roflow_secret_key_888' },
    });
    const statusData = await statusRes.json();
    assert(statusRes.status === 200 && statusData.success === true, 'GET /api/v1/robot/orders/status returns status');
    assert(statusData.status === 'PENDING', 'Status is PENDING');
    assert(statusData.total_amount === 150, 'Total amount is 150');

    // 5. QR Code Image endpoint for created order -> 200 PNG
    const qrImageRes = await fetch(`${BASE}/api/v1/robot/qr-image/${createdOrderId}.png`);
    assert(qrImageRes.status === 200 && qrImageRes.headers.get('content-type') === 'image/png', 'GET /api/v1/robot/qr-image/:id.png returns image/png');

    // 6. QR Code Image endpoint for non-existent order -> 404
    const qrImage404Res = await fetch(`${BASE}/api/v1/robot/qr-image/non_existent_id.png`);
    assert(qrImage404Res.status === 404, 'GET /api/v1/robot/qr-image/non_existent_id.png returns 404');

    // 7. Wallet payment API -> 200 OK
    const payRes = await fetch(`${BASE}/api/v1/wallet/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 1,
        qr_code_token: createdQrToken,
        pin: '1234',
      }),
    });
    const payData = await payRes.json();
    assert(payRes.status === 200 && payData.success === true, 'POST /api/v1/wallet/pay completes payment');
    assert(payData.data.status === 'PAID', 'Returned payment status is PAID');

    // 8. Re-query order status -> PAID
    const statusAfterPayRes = await fetch(`${BASE}/api/v1/web/orders/status/${createdOrderId}`);
    const statusAfterPayData = await statusAfterPayRes.json();
    assert(statusAfterPayData.status === 'PAID', 'Order status is now verified as PAID');

    console.log('\n====================================================');
    console.log(` HTTP API Tests Complete: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');
  } finally {
    server.close();
  }
}

runApiTests().catch((err) => {
  console.error('API Test Error:', err);
  process.exit(1);
});
