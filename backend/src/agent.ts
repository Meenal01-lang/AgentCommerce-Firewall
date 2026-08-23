import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { prisma, getPolicyConfig } from './db';
import { validatePolicy, logAuditEntry } from './policy';

// Initialize LLM clients if keys are present
const getLLMClient = () => {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    return { type: 'gemini', client: new GoogleGenAI({ apiKey: geminiKey }) };
  } else if (openaiKey) {
    return { type: 'openai', client: new OpenAI({ apiKey: openaiKey }) };
  } else {
    // Return simulated LLM client if keys are missing (so the app doesn't crash on start)
    return { type: 'mock', client: null };
  }
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  reasoning: string;
  action: 'MESSAGE' | 'QUOTE' | 'REFUND';
  params: any;
}

const SYSTEM_PROMPT_TEMPLATE = (catalogJson: string, policyJson: string) => `
You are "Nexus Agentic Commerce Assistant", a smart checkout agent representing our store.
You help customers find products, calculate pricing, offer eligible discounts/bundles, and manage returns/refunds.

You must respond ONLY in a structured JSON format containing the following three fields:
1. "reasoning": A detailed explanation of your analysis. Explain how you match items from the catalog, bundle deals, how you determine if any discounts are within the policy caps, or why a request is being blocked.
2. "action": One of the following strings:
   - "MESSAGE": Standard text response to the user (e.g. greeting, answering catalog questions, explaining policy blocks).
   - "QUOTE": Proposing a specific purchase quote of one or more items. DO NOT create orders directly; proposing a quote will generate a confirmation button in the UI for the customer.
   - "REFUND": Proposing a refund for an order.
3. "params": Action parameters:
   - For "MESSAGE": { "text": "Your message to the buyer" }
   - For "QUOTE": {
       "items": [{ "productId": "UUID_HERE", "quantity": 1 }],
       "discountPercent": 0, // Set discount percentage if requested
       "reason": "Why this quote/discount is offered"
     }
   - For "REFUND": { "orderId": "ORDER_UUID", "amount": 100, "reason": "Customer request" }

---
### PRODUCT CATALOG
${catalogJson}

---
### POLICY LIMITS (MONEY ACTION FIREWALL)
${policyJson}

---
### BUNDLE DEALS AVAILABLE
- If a customer buys any product with tags "shoes" and "socks" together, suggest a bundle quote.
- If a customer buys "Nexus FitBand V4" and "AeroPulse Wireless Earbuds" together, they can get a 10% discount on the combo (propose it as 10% discount in the QUOTE params).

---
### CRITICAL INSTRUCTIONS
1. Catalog Queries: If the buyer asks for items under a price (e.g. "under 3000"), match products from the catalog.
2. Discount Policy: You may suggest discounts (e.g. 5%, 10%) to satisfy a buyer. Check the POLICY LIMITS. If they ask for a discount higher than maxDiscountPercent, explain that the store policy prevents it. Suggest the maximum permitted discount instead.
3. Order Confirmation: You can only propose a QUOTE. The buyer must explicitly click "Confirm" in the UI to trigger checkout. Do not pretend you checked them out. Just say: "I have prepared a quote for you. Please confirm the purchase by clicking the button below."
4. If a prior transaction failed due to payment issues (e.g. Razorpay payment failure), explain that their card was declined or mock banking failed, and offer a retry quote or alternative low-cost items.
5. All money actions will go through the policy firewall. Check policy rules before proposing.
`;

export async function runAgent(
  sessionId: string,
  buyerMessage: string,
  history: ChatMessage[]
): Promise<AgentResponse> {
  const products = await prisma.product.findMany({});
  const policy = await getPolicyConfig();

  const catalogStr = JSON.stringify(products, null, 2);
  const policyStr = JSON.stringify({
    maxDiscountPercent: policy.maxDiscountPercent,
    maxSingleOrderVal: policy.maxSingleOrderVal,
    maxRefundAmount: policy.maxRefundAmount,
    maxSpendPerSession: policy.maxSpendPerSession,
  }, null, 2);

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE(catalogStr, policyStr);

  const api = getLLMClient();

  let responseText = '';

  const messagesPayload = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: buyerMessage },
  ];

  if (api.type === 'gemini' && api.client) {
    try {
      // Use Gemini 2.5/3.5 standard model
      const modelName = 'gemini-2.5-flash';
      // Map message roles
      const contents = messagesPayload.map((m) => ({
        role: m.role === 'system' ? 'user' : m.role,
        parts: [{ text: m.role === 'system' ? `[System Context]\n${m.content}` : m.content }],
      }));

      const res = await (api.client as any).models.generateContent({
        model: modelName,
        contents,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      responseText = res.text || '';
    } catch (err) {
      console.error('Gemini API Error:', err);
      responseText = JSON.stringify({
        reasoning: 'Gemini API call failed, falling back to mock agent.',
        action: 'MESSAGE',
        params: { text: 'Sorry, I encountered an issue communicating with my brain. Please try again.' },
      });
    }
  } else if (api.type === 'openai' && api.client) {
    try {
      const res = await (api.client as any).chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messagesPayload as any,
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      responseText = res.choices[0]?.message?.content || '';
    } catch (err) {
      console.error('OpenAI API Error:', err);
      responseText = JSON.stringify({
        reasoning: 'OpenAI API call failed, falling back to mock agent.',
        action: 'MESSAGE',
        params: { text: 'Sorry, I encountered an issue communicating with my brain. Please try again.' },
      });
    }
  } else {
    // Mock simulation if no keys provided
    responseText = simulateMockAgentResponse(buyerMessage, products, policy);
  }

  // Parse response
  let agentResponse: AgentResponse;
  try {
    agentResponse = JSON.parse(responseText);
    if (!agentResponse.reasoning || !agentResponse.action || !agentResponse.params) {
      throw new Error('Missing JSON fields');
    }
  } catch (err) {
    console.error('Error parsing agent JSON response:', responseText, err);
    agentResponse = {
      reasoning: `Error parsing raw LLM response. Raw: ${responseText.substring(0, 150)}`,
      action: 'MESSAGE',
      params: { text: "I'm having trouble formatting my response. Let me try again." },
    };
  }

  // Log action evaluations directly (e.g. when agent proposes a refund or quote discount)
  // Note: Standard browsing/messaging actions can be logged asAPPROVED because they don't involve money transfers.
  // Real monetary checkout actions (like Order Creation) are logged during /api/agent/checkout, but the agent's proposals
  // are logged here as audit traces for LLM transparency.
  
  if (agentResponse.action === 'REFUND') {
    const refundParams = agentResponse.params;
    // Pre-validate refund proposed by agent
    const policyCheck = await validatePolicy('REFUND', sessionId, {
      amount: refundParams.amount,
      orderId: refundParams.orderId,
    });

    await logAuditEntry({
      sessionId,
      buyerMessage,
      agentReasoning: agentResponse.reasoning,
      actionType: 'REFUND_PROPOSAL',
      actionDetails: refundParams,
      policyStatus: policyCheck.allowed ? 'APPROVED' : 'BLOCKED',
      policyReason: policyCheck.reason,
      policySnapshot: policyCheck.policySnapshot,
    });
  } else if (agentResponse.action === 'QUOTE') {
    const quoteParams = agentResponse.params;
    // Check if discount is within bounds
    const discountCheck = await validatePolicy('DISCOUNT', sessionId, {
      discountPercent: quoteParams.discountPercent || 0,
    });

    await logAuditEntry({
      sessionId,
      buyerMessage,
      agentReasoning: agentResponse.reasoning,
      actionType: 'QUOTE_PROPOSAL',
      actionDetails: quoteParams,
      policyStatus: discountCheck.allowed ? 'APPROVED' : 'BLOCKED',
      policyReason: discountCheck.reason,
      policySnapshot: discountCheck.policySnapshot,
    });
  } else {
    // Normal BROWSE / MESSAGE
    const snapshot = {
      maxDiscountPercent: policy.maxDiscountPercent,
      maxSingleOrderVal: policy.maxSingleOrderVal,
      maxRefundAmount: policy.maxRefundAmount,
      maxSpendPerSession: policy.maxSpendPerSession,
      whitelistedUpsell: policy.whitelistedUpsell,
    };
    await logAuditEntry({
      sessionId,
      buyerMessage,
      agentReasoning: agentResponse.reasoning,
      actionType: 'CONVERSATION',
      actionDetails: { message: buyerMessage, reply: agentResponse.params.text },
      policyStatus: 'APPROVED',
      policySnapshot: snapshot,
    });
  }

  return agentResponse;
}

// Simple rule-based mock agent runner for offline/no-API-key mode
function simulateMockAgentResponse(
  message: string,
  products: any[],
  policy: any
): string {
  const query = message.toLowerCase();
  const snapshot = {
    maxDiscountPercent: policy.maxDiscountPercent,
    maxSingleOrderVal: policy.maxSingleOrderVal,
    maxRefundAmount: policy.maxRefundAmount,
    maxSpendPerSession: policy.maxSpendPerSession,
    whitelistedUpsell: policy.whitelistedUpsell,
  };

  // Find running shoes
  const runningShoes = products.find((p) => p.name.includes('Running Shoes Pro'));
  const socks = products.find((p) => p.name.includes('Socks'));

  if (query.includes('shoes') && query.includes('under') && (query.includes('3000') || query.includes('30000'))) {
    if (runningShoes) {
      // Propose quote
      return JSON.stringify({
        reasoning: `Buyer requested running shoes under 3000. Matched product '${runningShoes.name}' priced at ₹${runningShoes.price}, which satisfies budget limit. Proposing a clean quote.`,
        action: 'QUOTE',
        params: {
          items: [{ productId: runningShoes.id, quantity: 1 }],
          discountPercent: 0,
          reason: 'Matched budget running shoes',
        },
      });
    }
  }

  if (query.includes('discount') || query.includes('deal') || query.includes('bundle')) {
    // If they buy shoes + socks, propose bundle
    if (runningShoes && socks) {
      const discount = 15; // Propose 15% discount
      const isAllowed = discount <= policy.maxDiscountPercent;
      return JSON.stringify({
        reasoning: `Buyer requested a discount or bundle deal. Proposing a Running Shoes + Active Socks bundle with a ${discount}% discount. Store policy limit is ${policy.maxDiscountPercent}%. Firewall check will pass: ${isAllowed}.`,
        action: 'QUOTE',
        params: {
          items: [
            { productId: runningShoes.id, quantity: 1 },
            { productId: socks.id, quantity: 1 },
          ],
          discountPercent: discount,
          reason: 'Running Shoes + Socks activewear bundle discount',
        },
      });
    }
  }

  if (query.includes('refund')) {
    // Extract a mock UUID or use a dummy
    const orderIdMatch = message.match(/[0-9a-fA-F-]{36}/);
    const orderId = orderIdMatch ? orderIdMatch[0] : 'mock-order-id-1234';
    return JSON.stringify({
      reasoning: `Buyer requested a refund for order '${orderId}'. Checking limits: requested amount ₹1000 is under refund cap of ₹${policy.maxRefundAmount}. Proposing refund.`,
      action: 'REFUND',
      params: {
        orderId,
        amount: 1000,
        reason: 'Requested by buyer in mock chat mode',
      },
    });
  }

  // Fallback text reply
  return JSON.stringify({
    reasoning: 'Buyer sent general inquiry. Matching keywords failed. Providing list of main categories in store (Sports, Wearables, Apparel).',
    action: 'MESSAGE',
    params: {
      text: `Hello! I am Nexus Shop Assistant. I can help you find running shoes, fitness trackers, compression shorts, and bundle deals. Try asking: "Do you have running shoes under 3000?" or "What bundle deals are available?"`,
    },
  });
}
