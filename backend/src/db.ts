import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Helper to get singleton policy config
export async function getPolicyConfig() {
  let policy = await prisma.policy.findUnique({
    where: { id: 'singleton' },
  });
  if (!policy) {
    // Return default if not exists (fallback)
    policy = await prisma.policy.create({
      data: {
        id: 'singleton',
        maxDiscountPercent: 20.0,
        maxSingleOrderVal: 10000.0,
        maxRefundAmount: 5000.0,
        maxSpendPerSession: 25000.0,
        whitelistedUpsell: '',
      },
    });
  }
  return policy;
}
