import http from 'http';

const API_BASE_URL = 'http://localhost:5000';

// Helper to make POST requests
function postJSON(path: string, payload: any, headers: any = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': dataString.length,
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 0,
            data: body ? JSON.parse(body) : {}
          });
        } catch (e) {
          resolve({ status: res.statusCode || 0, data: { raw: body } });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(dataString);
    req.end();
  });
}

// Helper to make GET requests
function getJSON(path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    http.get(`${API_BASE_URL}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 0,
            data: JSON.parse(body)
          });
        } catch (e) {
          resolve({ status: res.statusCode || 0, data: { raw: body } });
        }
      });
    }).on('error', (err) => reject(err));
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('       NEXUS INTEGRATION VERIFICATION SUITE         ');
  console.log('====================================================');

  try {
    // 1. Verify Catalog API & Well Known Manifest
    console.log('\n[1/5] Verifying Catalog & Manifest Accessibility...');
    const catCheck = await getJSON('/api/catalog');
    console.log(`- GET /api/catalog returned: Status ${catCheck.status}, Items count: ${catCheck.data.length}`);
    if (catCheck.status !== 200 || !Array.isArray(catCheck.data)) {
      throw new Error('Catalog API returned bad response');
    }
    const sampleProduct = catCheck.data[0];
    console.log(`- Sample Product ID: ${sampleProduct.id} (${sampleProduct.name})`);

    const manifestCheck = await getJSON('/.well-known/agent-commerce.json');
    console.log(`- GET /.well-known/agent-commerce.json: Status ${manifestCheck.status}, Version: ${manifestCheck.data.schemaVersion}`);
    if (manifestCheck.status !== 200 || !manifestCheck.data.actions) {
      throw new Error('Agent Manifest not formatted correctly');
    }

    // Generate unique sessionId for this test pass
    const sessionId = `test_session_${Math.random().toString(36).substring(2, 8)}`;
    console.log(`\nActive Test Session Key: ${sessionId}`);

    // 2. Test Policy Firewall Rejection (50% discount)
    console.log('\n[2/5] Testing Money Action Firewall Block (50% discount limit test)...');
    const blockPayload = {
      sessionId,
      items: [{ productId: sampleProduct.id, quantity: 1 }],
      discountPercent: 50, // Rejects, cap is 20%
      customerName: 'Test Buyer - Blocked Check'
    };

    const blockRes = await postJSON('/api/agent/checkout', blockPayload);
    console.log(`- Response Status (Expected 400): ${blockRes.status}`);
    console.log(`- Rejection Message: "${blockRes.data.reason}"`);
    console.log(`- Captured policySnapshot MaxDiscount limit: ${blockRes.data.policySnapshot?.maxDiscountPercent}%`);
    if (blockRes.status !== 400 || !blockRes.data.policySnapshot) {
      throw new Error('Firewall failed to block checkout or failed to return policy snapshot');
    }

    // 3. Test Policy Firewall Approval (5% discount)
    console.log('\n[3/5] Testing Money Action Firewall Approval (5% discount)...');
    const approvePayload = {
      sessionId,
      items: [{ productId: sampleProduct.id, quantity: 1 }],
      discountPercent: 5, // Passes
      customerName: 'Test Buyer - Approved Check'
    };

    const approveRes = await postJSON('/api/agent/checkout', approvePayload);
    console.log(`- Response Status (Expected 200): ${approveRes.status}`);
    console.log(`- Created Razorpay Order Ref ID: ${approveRes.data.order?.razorpayOrderId}`);
    if (approveRes.status !== 200 || !approveRes.data.order) {
      throw new Error('Firewall blocked a valid policy-approved checkout');
    }
    const createdOrderId = approveRes.data.order.id;

    // 4. Test Checkout Idempotency (Repeat checkout within short window)
    console.log('\n[4/5] Testing Checkout Idempotency (Sending duplicate request)...');
    const dupRes = await postJSON('/api/agent/checkout', approvePayload);
    console.log(`- Response Status (Expected 200): ${dupRes.status}`);
    console.log(`- Duplicate Flag: ${dupRes.data.isDuplicate}`);
    console.log(`- Match Database Order ID: ${dupRes.data.order?.id === createdOrderId ? 'MATCH (Correct)' : 'MISMATCH (Error)'}`);
    if (dupRes.status !== 200 || !dupRes.data.isDuplicate || dupRes.data.order?.id !== createdOrderId) {
      throw new Error('Idempotency failed to catch and reroute duplicate request');
    }

    // 5. Test Webhook Security Verification
    console.log('\n[5/5] Testing Webhook Signature Verification Gate...');
    const fakeWebhook = {
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_test_xyz', order_id: approveRes.data.order.razorpayOrderId } }
      }
    };
    
    // Call webhook with fake headers (bad signature)
    const webhookRes = await postJSON('/api/webhooks/razorpay', fakeWebhook, {
      'x-razorpay-signature': 'invalid_signature_hashes'
    });
    console.log(`- Webhook signature response status (Expected 400): ${webhookRes.status}`);
    console.log(`- Server response message: "${webhookRes.data.error || 'Check failed'}"`);
    if (webhookRes.status !== 400) {
      throw new Error('Webhook endpoint accepted transaction without valid SDK signature verification');
    }

    console.log('\n====================================================');
    console.log('      INTEGRATION SUITE COMPLETED SUCCESSFULLY      ');
    console.log('====================================================');

  } catch (error: any) {
    console.error('\n❌ INTEGRATION TEST CRITICAL EXCEPTION:', error.message);
    process.exit(1);
  }
}

// Run test sequence
runTests();
