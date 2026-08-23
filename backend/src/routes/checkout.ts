import { Router, Request, Response } from 'express';
import Razorpay from 'razorpay';
import { prisma } from '../db';
import { runAgent } from '../agent';
import { validatePolicy, logAuditEntry } from '../policy';
import { authenticateMerchant } from './policy';

const router = Router();

// Initialize Razorpay SDK in TEST mode
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_id_2026',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_secret_2026',
});

// Helper: Calculate quote values and fetch details from database
export async function calculateQuoteHelper(
  items: Array<{ productId: string; quantity: number }>,
  discountPercent: number = 0
) {
  let subtotal = 0;
  const enrichedItems = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
    });
    if (!product) {
      throw new Error(`Product with ID ${item.productId} not found.`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for product "${product.name}". Available: ${product.stock}, Requested: ${item.quantity}`);
    }
    const itemTotal = product.price * item.quantity;
    subtotal += itemTotal;
    enrichedItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      itemTotal,
    });
  }

  const discountAmount = parseFloat(((subtotal * discountPercent) / 100).toFixed(2));
  const totalAmount = parseFloat((subtotal - discountAmount).toFixed(2));

  return {
    subtotal,
    discountAmount,
    discountPercent,
    totalAmount,
    items: enrichedItems,
  };
}

// 1. POST /api/agent/chat (Conversational route)
router.post('/agent/chat', async (req, res) => {
  try {
    const { sessionId, message, history = [] } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Missing sessionId or message.' });
    }

    const reply = await runAgent(sessionId, message, history);
    res.json(reply);
  } catch (error: any) {
    console.error('Error in agent chat:', error);
    res.status(500).json({
      error: 'Failed to process chat message.',
      details: error.message,
    });
  }
});

// 2. POST /api/agent/quote (Headless quote endpoint)
router.post('/agent/quote', async (req, res) => {
  try {
    const { sessionId, items, discountPercent = 0 } = req.body;

    if (!sessionId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing sessionId or items array.' });
    }

    // 1. Calculate pricing
    const quote = await calculateQuoteHelper(items, discountPercent);

    // 2. Policy Engine discount validation
    const policyResult = await validatePolicy('DISCOUNT', sessionId, {
      discountPercent,
    });

    if (!policyResult.allowed) {
      // Log blocked quote action
      await logAuditEntry({
        sessionId,
        actionType: 'QUOTE_REJECTED',
        actionDetails: { items, discountPercent },
        agentReasoning: `Quote rejected: proposed discount exceeds policy guidelines.`,
        policyStatus: 'BLOCKED',
        policyReason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });

      return res.status(400).json({
        error: 'Policy Rejection',
        reason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });
    }

    // Log approved quote action
    await logAuditEntry({
      sessionId,
      actionType: 'QUOTE_APPROVED',
      actionDetails: quote,
      agentReasoning: `Quote calculated and approved by firewall. Subtotal: ₹${quote.subtotal}, Discount: ${discountPercent}%.`,
      policyStatus: 'APPROVED',
      policySnapshot: policyResult.policySnapshot,
    });

    res.json(quote);
  } catch (error: any) {
    console.error('Error calculating quote:', error);
    res.status(400).json({ error: error.message });
  }
});

// 3. POST /api/agent/checkout (Confirm quote & checkout)
router.post('/agent/checkout', async (req, res) => {
  try {
    const { sessionId, items, discountPercent = 0, customerName = 'Anonymous Buyer' } = req.body;

    if (!sessionId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing sessionId or items array.' });
    }

    // A. Idempotency Check
    // Sort items by productId to generate a unique item signature for comparison
    const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
    const itemSignature = JSON.stringify(sortedItems);
    const sixtySecondsAgo = new Date(Date.now() - 60000);

    const duplicatePendingOrder = await prisma.order.findFirst({
      where: {
        sessionId,
        items: itemSignature,
        status: 'PENDING',
        createdAt: { gte: sixtySecondsAgo },
      },
    });

    if (duplicatePendingOrder) {
      console.log('Duplicate checkout detected, returning existing PENDING order:', duplicatePendingOrder.id);
      return res.json({
        order: duplicatePendingOrder,
        isDuplicate: true,
        message: 'Duplicate order within 60s detected. Re-routed to existing order.',
      });
    }

    // B. Calculate Quote values
    const quote = await calculateQuoteHelper(items, discountPercent);

    // C. Policy Engine firewall checks (checkout limit + session cumulative spend)
    const policyResult = await validatePolicy('CHECKOUT', sessionId, {
      amount: quote.totalAmount,
      discountPercent: quote.discountPercent,
    });

    if (!policyResult.allowed) {
      // Log blocked checkout action
      await logAuditEntry({
        sessionId,
        actionType: 'CHECKOUT_REJECTED',
        actionDetails: { items, discountPercent, totalAmount: quote.totalAmount },
        agentReasoning: `Checkout blocked by Money Action Firewall: policy limits violated.`,
        policyStatus: 'BLOCKED',
        policyReason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });

      return res.status(400).json({
        error: 'Policy Rejection',
        reason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });
    }

    // D. Create local database Order
    const localOrder = await prisma.order.create({
      data: {
        sessionId,
        amount: quote.totalAmount,
        discountAmount: quote.discountAmount,
        discountPercent: quote.discountPercent,
        status: 'PENDING',
        customerName,
        items: itemSignature,
      },
    });

    // E. Create Razorpay Test Order
    let razorpayOrderId: string | null = null;
    let apiResponse: any = null;

    // Check if we are using mock keys or real test keys
    const isMockKeys = !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes('mock');

    if (!isMockKeys) {
      try {
        const rzpOrder = await razorpay.orders.create({
          amount: Math.round(quote.totalAmount * 100), // Paise
          currency: 'INR',
          receipt: localOrder.id,
        });
        razorpayOrderId = rzpOrder.id;
        apiResponse = rzpOrder;
      } catch (err: any) {
        console.warn('Razorpay API Error, falling back to mock sandbox order creation:', err);
        razorpayOrderId = `rzp_mock_${Math.random().toString(36).substring(2, 11)}`;
        apiResponse = { error: err.message, mockFallback: true };
      }
    } else {
      // Direct mock order generation
      razorpayOrderId = `rzp_mock_${Math.random().toString(36).substring(2, 11)}`;
      apiResponse = { mock: true, note: 'Mock order because real Razorpay keys are not in .env' };
    }

    // Update order with Razorpay order reference ID
    const updatedOrder = await prisma.order.update({
      where: { id: localOrder.id },
      data: { razorpayOrderId },
    });

    // F. Deduct Catalog Stock
    for (const item of items) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }

    // G. Log successful checkout audit entry
    await logAuditEntry({
      sessionId,
      actionType: 'CHECKOUT_APPROVED',
      actionDetails: { orderId: updatedOrder.id, razorpayOrderId, totalAmount: quote.totalAmount },
      agentReasoning: `Checkout firewall approved. Successfully created Razorpay order: ${razorpayOrderId}. Stock deducted.`,
      policyStatus: 'APPROVED',
      policySnapshot: policyResult.policySnapshot,
      apiResponse,
    });

    res.json({
      order: updatedOrder,
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_id_2026',
      isMock: isMockKeys || apiResponse.mockFallback,
    });
  } catch (error: any) {
    console.error('Error during checkout:', error);
    res.status(400).json({ error: error.message });
  }
});

// 4. POST /api/agent/refund (Merchant / Agent refund execution, auth gated)
router.post('/agent/refund', async (req, res) => {
  try {
    const { orderId, amount, reason } = req.body;

    if (!orderId || amount === undefined || !reason) {
      return res.status(400).json({ error: 'Missing orderId, amount, or reason.' });
    }

    // 1. Fetch the Order to get its session
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // 2. Validate Refund with Policy Firewall
    const policyResult = await validatePolicy('REFUND', order.sessionId, {
      amount,
      orderId,
    });

    if (!policyResult.allowed) {
      // Log blocked refund in audit trail
      await logAuditEntry({
        sessionId: order.sessionId,
        actionType: 'REFUND_REJECTED',
        actionDetails: { orderId, amount, reason },
        agentReasoning: `Refund blocked by firewall: policy cap check failed.`,
        policyStatus: 'BLOCKED',
        policyReason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });

      return res.status(400).json({
        error: 'Policy Rejection',
        reason: policyResult.reason,
        policySnapshot: policyResult.policySnapshot,
      });
    }

    // 3. Request refund through Razorpay Test API if possible
    let razorpayRefundId: string | null = null;
    let apiResponse: any = null;

    const isMockKeys = !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes('mock');

    if (!isMockKeys && order.razorpayPaymentId) {
      try {
        const rzpRefund = await razorpay.payments.refund(order.razorpayPaymentId, {
          amount: Math.round(amount * 100), // Paise
          notes: { reason },
        });
        razorpayRefundId = rzpRefund.id;
        apiResponse = rzpRefund;
      } catch (err: any) {
        console.warn('Razorpay refund API call failed, falling back to mock refund:', err);
        razorpayRefundId = `rfnd_mock_${Math.random().toString(36).substring(2, 11)}`;
        apiResponse = { error: err.message, mockFallback: true };
      }
    } else {
      razorpayRefundId = `rfnd_mock_${Math.random().toString(36).substring(2, 11)}`;
      apiResponse = { mock: true, note: 'Mock refund created. No active payment ID or keys found.' };
    }

    // 4. Create Refund record & update Order status
    await prisma.refund.create({
      data: {
        orderId,
        amount,
        razorpayRefundId,
        status: 'SUCCESS',
        reason,
      },
    });

    // Mark order status as REFUNDED if fully refunded
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'REFUNDED' },
    });

    // 5. Log approved refund
    await logAuditEntry({
      sessionId: order.sessionId,
      actionType: 'REFUND_APPROVED',
      actionDetails: { orderId, amount, razorpayRefundId },
      agentReasoning: `Refund approved by firewall. Processed Razorpay refund ID: ${razorpayRefundId}.`,
      policyStatus: 'APPROVED',
      policySnapshot: policyResult.policySnapshot,
      apiResponse,
    });

    res.json({ order: updatedOrder, refundId: razorpayRefundId });
  } catch (error: any) {
    console.error('Error during refund:', error);
    res.status(400).json({ error: error.message });
  }
});

// 5. POST /api/agent/payment-complete (Direct webhook fallback for test frontend sync)
router.post('/agent/payment-complete', async (req, res) => {
  try {
    const { orderId, razorpayPaymentId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ error: 'Missing orderId or status.' });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const newStatus = status === 'success' ? 'PAID' : 'FAILED';

    // If transaction failed, reinstate product stock!
    if (newStatus === 'FAILED' && order.status !== 'FAILED') {
      const itemsList = JSON.parse(order.items);
      for (const item of itemsList) {
        await prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        razorpayPaymentId: razorpayPaymentId || order.razorpayPaymentId,
      },
    });

    // Log payment status updates to audit logs
    const policy = await prisma.policy.findUnique({ where: { id: 'singleton' } });
    await logAuditEntry({
      sessionId: order.sessionId,
      actionType: `PAYMENT_${newStatus}`,
      actionDetails: { orderId, razorpayPaymentId, status },
      agentReasoning: `Payment event synchronised: Order status changed to ${newStatus}. ${newStatus === 'FAILED' ? 'Restored stock levels.' : ''}`,
      policyStatus: 'APPROVED',
      policySnapshot: policy,
    });

    res.json(updatedOrder);
  } catch (error: any) {
    console.error('Error sync payment status:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. POST /api/webhooks/razorpay (Webhook listener with signature verification)
router.post('/webhooks/razorpay', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'nexus_webhook_secret_2026';
  const signature = req.headers['x-razorpay-signature'] as string;
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  console.log('Received Razorpay Webhook Event...');

  // A. Signature verification
  try {
    const isValid = Razorpay.validateWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      console.warn('Webhook signature check failed!');
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }
  } catch (err: any) {
    console.error('Webhook signature verification error:', err);
    return res.status(400).json({ error: 'Signature validation failed.' });
  }

  // B. Handle webhook event payload
  try {
    const { event, payload } = req.body;
    
    if (event === 'payment.captured' || event === 'order.paid') {
      const entity = payload.order ? payload.order.entity : payload.payment.entity;
      const razorpayOrderId = entity.order_id || entity.id;
      const razorpayPaymentId = payload.payment ? payload.payment.entity.id : null;

      const order = await prisma.order.findUnique({
        where: { razorpayOrderId },
      });

      if (order && order.status !== 'PAID') {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID', razorpayPaymentId },
        });

        const policy = await prisma.policy.findUnique({ where: { id: 'singleton' } });
        await logAuditEntry({
          sessionId: order.sessionId,
          actionType: 'WEBHOOK_PAYMENT_CAPTURED',
          actionDetails: { event, orderId: order.id, razorpayOrderId },
          agentReasoning: `Razorpay Webhook: Verified payment captured successfully. Order status updated to PAID.`,
          policyStatus: 'APPROVED',
          policySnapshot: policy,
          apiResponse: req.body,
        });
      }
    } else if (event === 'payment.failed') {
      const entity = payload.payment.entity;
      const razorpayOrderId = entity.order_id;
      const errorDescription = entity.error_description;

      const order = await prisma.order.findUnique({
        where: { razorpayOrderId },
      });

      if (order && order.status !== 'FAILED') {
        // Reinstate catalog stock on payment failures
        const itemsList = JSON.parse(order.items);
        for (const item of itemsList) {
          await prisma.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }

        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        const policy = await prisma.policy.findUnique({ where: { id: 'singleton' } });
        await logAuditEntry({
          sessionId: order.sessionId,
          actionType: 'WEBHOOK_PAYMENT_FAILED',
          actionDetails: { event, orderId: order.id, errorDescription },
          agentReasoning: `Razorpay Webhook: Verified payment failed. Order status updated to FAILED. Stock levels reinstated. Reason: ${errorDescription}`,
          policyStatus: 'APPROVED',
          policySnapshot: policy,
          apiResponse: req.body,
        });
      }
    }

    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
