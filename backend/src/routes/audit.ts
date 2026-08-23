import { Router } from 'express';
import { prisma } from '../db';
import { authenticateMerchant } from './policy';

const router = Router();

// GET /api/audit - Get chronological list of audit logs (gated)
router.get('/audit', authenticateMerchant, async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100, // Cap at 100 entries for readability
    });

    // Parse stringified JSON fields for easier frontend usage
    const parsedLogs = logs.map((log) => ({
      ...log,
      actionDetails: log.actionDetails ? JSON.parse(log.actionDetails) : null,
      policySnapshot: log.policySnapshot ? JSON.parse(log.policySnapshot) : null,
      apiResponse: log.apiResponse ? JSON.parse(log.apiResponse) : null,
    }));

    res.json(parsedLogs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to retrieve audit trail logs.' });
  }
});

export default router;
