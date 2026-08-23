import { Router, Request, Response, NextFunction } from 'express';
import { prisma, getPolicyConfig } from '../db';

const router = Router();

// Authentication middleware using MERCHANT_AUTH_TOKEN
export function authenticateMerchant(req: Request, res: Response, next: NextFunction) {
  const token = process.env.MERCHANT_AUTH_TOKEN || 'nexus-secret-key-2026';
  
  // Accept token from Authorization header (Bearer token) or query parameter/custom header
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string;
  const customHeader = req.headers['x-nexus-token'] as string;

  let providedToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.split(' ')[1];
  } else if (queryToken) {
    providedToken = queryToken;
  } else if (customHeader) {
    providedToken = customHeader;
  }

  if (!providedToken || providedToken !== token) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing merchant auth token.' });
  }

  next();
}

// GET /api/policy - Fetch current policy settings (gated)
router.get('/policy', authenticateMerchant, async (req, res) => {
  try {
    const policy = await getPolicyConfig();
    res.json(policy);
  } catch (error) {
    console.error('Error fetching policy:', error);
    res.status(500).json({ error: 'Failed to fetch policy configuration.' });
  }
});

// POST /api/policy - Update policy settings (gated)
router.post('/policy', authenticateMerchant, async (req, res) => {
  try {
    const {
      maxDiscountPercent,
      maxSingleOrderVal,
      maxRefundAmount,
      maxSpendPerSession,
      whitelistedUpsell,
    } = req.body;

    // Validate request inputs
    if (
      maxDiscountPercent === undefined ||
      maxSingleOrderVal === undefined ||
      maxRefundAmount === undefined ||
      maxSpendPerSession === undefined
    ) {
      return res.status(400).json({ error: 'Missing required policy fields.' });
    }

    const updated = await prisma.policy.update({
      where: { id: 'singleton' },
      data: {
        maxDiscountPercent: parseFloat(maxDiscountPercent),
        maxSingleOrderVal: parseFloat(maxSingleOrderVal),
        maxRefundAmount: parseFloat(maxRefundAmount),
        maxSpendPerSession: parseFloat(maxSpendPerSession),
        whitelistedUpsell: whitelistedUpsell || '',
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating policy:', error);
    res.status(500).json({ error: 'Failed to update policy configuration.' });
  }
});

export default router;
