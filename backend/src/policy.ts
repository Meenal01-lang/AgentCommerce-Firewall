import { prisma, getPolicyConfig } from './db';

export interface PolicyValidationResult {
  allowed: boolean;
  reason?: string;
  policySnapshot: any;
}

export async function validatePolicy(
  actionType: 'DISCOUNT' | 'CHECKOUT' | 'REFUND',
  sessionId: string,
  details: {
    amount?: number;          // Required for CHECKOUT and REFUND
    discountPercent?: number; // Required for DISCOUNT and CHECKOUT
    orderId?: string;         // Required for REFUND
    itemsCount?: number;
  }
): Promise<PolicyValidationResult> {
  const policy = await getPolicyConfig();
  const snapshot = {
    maxDiscountPercent: policy.maxDiscountPercent,
    maxSingleOrderVal: policy.maxSingleOrderVal,
    maxRefundAmount: policy.maxRefundAmount,
    maxSpendPerSession: policy.maxSpendPerSession,
    whitelistedUpsell: policy.whitelistedUpsell,
  };

  // 1. DISCOUNT Validation
  if (actionType === 'DISCOUNT' && details.discountPercent !== undefined) {
    if (details.discountPercent > policy.maxDiscountPercent) {
      return {
        allowed: false,
        reason: `Discount grant of ${details.discountPercent}% exceeds the maximum limit of ${policy.maxDiscountPercent}%.`,
        policySnapshot: snapshot,
      };
    }
  }

  // 2. CHECKOUT Validation
  if (actionType === 'CHECKOUT') {
    const totalAmount = details.amount || 0;
    const discountPercent = details.discountPercent || 0;

    // Check discount limit
    if (discountPercent > policy.maxDiscountPercent) {
      return {
        allowed: false,
        reason: `Checkout rejected: Proposed discount of ${discountPercent}% exceeds the maximum limit of ${policy.maxDiscountPercent}%.`,
        policySnapshot: snapshot,
      };
    }

    // Check single order value limit
    if (totalAmount > policy.maxSingleOrderVal) {
      return {
        allowed: false,
        reason: `Checkout rejected: Total amount ₹${totalAmount.toFixed(2)} exceeds the maximum single order limit of ₹${policy.maxSingleOrderVal.toFixed(2)}.`,
        policySnapshot: snapshot,
      };
    }

    // Check session cumulative spend limit
    // Find all paid/pending orders for this session and sum up their amount
    const activeOrders = await prisma.order.findMany({
      where: {
        sessionId,
        status: {
          in: ['PAID', 'PENDING'], // Count paid and pending checkout amounts
        },
      },
    });

    const cumulativeSpend = activeOrders.reduce((sum, order) => sum + order.amount, 0);
    if (cumulativeSpend + totalAmount > policy.maxSpendPerSession) {
      return {
        allowed: false,
        reason: `Session cap exceeded: Adding ₹${totalAmount.toFixed(2)} to your current session spend of ₹${cumulativeSpend.toFixed(2)} exceeds the session cap of ₹${policy.maxSpendPerSession.toFixed(2)}.`,
        policySnapshot: snapshot,
      };
    }
  }

  // 3. REFUND Validation
  if (actionType === 'REFUND') {
    const refundAmount = details.amount || 0;

    // Check refund limit
    if (refundAmount > policy.maxRefundAmount) {
      return {
        allowed: false,
        reason: `Refund rejected: Requested refund amount ₹${refundAmount.toFixed(2)} exceeds the maximum allowed refund limit of ₹${policy.maxRefundAmount.toFixed(2)}.`,
        policySnapshot: snapshot,
      };
    }

    // Check that we aren't refunding more than the order's actual amount (minus prior successful refunds)
    if (details.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: details.orderId },
        include: { refunds: true },
      });

      if (!order) {
        return {
          allowed: false,
          reason: `Refund rejected: Order with ID ${details.orderId} does not exist.`,
          policySnapshot: snapshot,
        };
      }

      if (order.status !== 'PAID') {
        return {
          allowed: false,
          reason: `Refund rejected: Cannot refund an order with status '${order.status}'. Only PAID orders can be refunded.`,
          policySnapshot: snapshot,
        };
      }

      const totalRefundedYet = order.refunds
        .filter((r) => r.status === 'SUCCESS' || r.status === 'PENDING')
        .reduce((sum, r) => sum + r.amount, 0);

      const remainingAmount = order.amount - totalRefundedYet;
      if (refundAmount > remainingAmount) {
        return {
          allowed: false,
          reason: `Refund rejected: Requested refund ₹${refundAmount.toFixed(2)} exceeds the remaining order balance of ₹${remainingAmount.toFixed(2)} (Original: ₹${order.amount.toFixed(2)}, Refunded: ₹${totalRefundedYet.toFixed(2)}).`,
          policySnapshot: snapshot,
        };
      }
    }
  }

  // If we reach here, it passes the Money Action Firewall!
  return {
    allowed: true,
    policySnapshot: snapshot,
  };
}

/**
 * Helper to log policy action evaluations to the AuditLog table
 */
export async function logAuditEntry(params: {
  sessionId: string;
  buyerMessage?: string | null;
  agentReasoning: string;
  actionType: string;
  actionDetails: any;
  policyStatus: 'APPROVED' | 'BLOCKED';
  policyReason?: string | null;
  policySnapshot: any;
  apiResponse?: any;
}) {
  return prisma.auditLog.create({
    data: {
      sessionId: params.sessionId,
      buyerMessage: params.buyerMessage || null,
      agentReasoning: params.agentReasoning,
      actionType: params.actionType,
      actionDetails: JSON.stringify(params.actionDetails),
      policyStatus: params.policyStatus,
      policyReason: params.policyReason || null,
      policySnapshot: JSON.stringify(params.policySnapshot),
      apiResponse: params.apiResponse ? JSON.stringify(params.apiResponse) : null,
    },
  });
}
