import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/catalog
router.get('/api/catalog', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (error) {
    console.error('Error fetching catalog:', error);
    res.status(500).json({ error: 'Failed to fetch catalog.' });
  }
});

// GET /.well-known/agent-commerce.json
router.get('/.well-known/agent-commerce.json', (req, res) => {
  const host = req.get('host');
  const protocol = req.secure ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}`;

  const manifest = {
    schemaVersion: "acp/v1",
    merchant: {
      name: "Nexus Agentic Commerce Gateway",
      description: "Automated, policy-governed merchant gateway using Razorpay sandbox.",
      baseUrl: baseUrl,
    },
    actions: {
      browseCatalog: {
        description: "Browse products in the merchant catalog.",
        endpoint: `${baseUrl}/api/catalog`,
        method: "GET",
        parameters: {}
      },
      requestQuote: {
        description: "Request a priced quote for cart items, with optional discount request.",
        endpoint: `${baseUrl}/api/agent/quote`,
        method: "POST",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Unique session key tracking this buyer's interaction." },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  productId: { type: "string", description: "Product UUID from catalog." },
                  quantity: { type: "integer", minimum: 1 }
                },
                required: ["productId", "quantity"]
              }
            },
            discountPercent: { type: "number", minimum: 0, maximum: 100, description: "Requested discount percentage." }
          },
          required: ["sessionId", "items"]
        }
      },
      confirmCheckout: {
        description: "Confirm an existing quote to create a Razorpay test order. Gated by money action firewall.",
        endpoint: `${baseUrl}/api/agent/checkout`,
        method: "POST",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Unique session key tracking this buyer's interaction." },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  productId: { type: "string", description: "Product UUID from catalog." },
                  quantity: { type: "integer", minimum: 1 }
                },
                required: ["productId", "quantity"]
              }
            },
            discountPercent: { type: "number", minimum: 0, maximum: 100 },
            customerName: { type: "string" }
          },
          required: ["sessionId", "items"]
        }
      },
      requestRefund: {
        description: "Request refund for an order. Auth gated and firewall check required.",
        endpoint: `${baseUrl}/api/agent/refund`,
        method: "POST",
        parameters: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "Order UUID." },
            amount: { type: "number", description: "Refund amount in INR." },
            reason: { type: "string", description: "Reason for the refund." }
          },
          required: ["orderId", "amount", "reason"]
        }
      }
    }
  };

  res.json(manifest);
});

export default router;
