# Nexus — Agentic Commerce Gateway for Merchants

Nexus is a policy-governed, agent-readable commerce gateway designed for automated and conversational purchasing. It interfaces with **Razorpay Test-Mode APIs** and exposes a machine-readable commerce manifest, permitting external AI agents (as well as human buyers) to discover catalog products, request quotes, and checkout under strict merchant firewall policies.

---

## Technical Architecture Overview

Nexus consists of an **Express Backend** storing logs/products in SQLite (via Prisma ORM) and a **Next.js Frontend (App Router)** styled with Tailwind CSS.

```
                  ┌────────────────────────────────────────┐
                  │          Buyer / Machine Agent         │
                  └────┬───────────────────────────────┬───┘
                       │ (Natural Chat)                │ (Headless API / curl)
                       ▼                               ▼
            ┌─────────────────────┐        ┌───────────────────────┐
            │   Chat UI / Client  │        │ Agent Commerce Spec   │
            │  (React / Next.js)  │        │ /.well-known/agent... │
            └──────────┬──────────┘        └───────────┬───────────┘
                       │                               │
                       │     POST /api/agent/checkout  │
                       ▼                               ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                        EXPRESS SERVER                       │
        │                                                             │
        │ ┌──────────────────────┐           ┌──────────────────────┐ │
        │ │     Policy Engine    │◄─────────►│  Idempotency Engine  │ │
        │ │   (Action Firewall)  │           │  (60-second window)  │ │
        │ └──────────┬───────────┘           └──────────────────────┘ │
        │            │                                                │
        │            ▼ Approved Transaction                           │
        │ ┌─────────────────────────────────────────────────────────┐ │
        │ │                 Razorpay test-mode SDK                  │ │
        │ └──────────────────────────┬──────────────────────────────┘ │
        └────────────────────────────┼────────────────────────────────┘
                                     ▼
                        ┌──────────────────────────┐
                        │   Razorpay API Sandbox   │
                        └──────────────────────────┘
```

### 1. Agent-Commerce Manifest (`/.well-known/agent-commerce.json`)
Nexus implements an ACP (Agent Commerce Protocol) inspired schema. External machine callers can fetch this file at startup to programmatically discover the catalog schema, quote calculations, checkout routes, and parameters required for transactions.

### 2. Conversational Agent & Structured Reasoning
The LLM integration (Gemini 2.5 Flash / GPT-4o-mini) is structured to output strict JSON schemas. Instead of attempting to extract raw chain-of-thought tokens, the model is instructed to write a `reasoning` text field alongside the selected `action` and `params`. This reasoning string is logged directly to the `AuditLog` database table for transparency.

### 3. Money Action Firewall (Policy Engine)
Every monetary proposal (discount allocation, order checkout, refund request) must pass through `validatePolicy()`. 
- **Discount Cap**: Prevents agent from granting discounts above the `maxDiscountPercent` (default 20%).
- **Order Limit**: Rejects order amounts above `maxSingleOrderVal` (default ₹10,000).
- **Refund Limit**: Rejects refunds above `maxRefundAmount` (default ₹5,000).
- **Session Spend Cap**: Tracks cumulative successful/pending spend for a specific `sessionId` and blocks checkout if the limit `maxSpendPerSession` (default ₹25,000) is exceeded.
- **Audit Policy Snapshots**: For historical audit integrity, every validation stores the exact policy rules active at that timestamp as a JSON object, ensuring subsequent modifications don't skew older records.

### 4. Idempotency Check
To prevent duplicate charging during agent retries or connection drops, the checkout checks for any `PENDING` order matching the same `sessionId` and catalog item structure in the last 60 seconds. If found, it bypasses Razorpay order generation and redirects to the existing checkout.

### 5. Webhook Signature Check
Razorpay webhook calls are protected via SDK verification checking the `x-razorpay-signature` against the local `RAZORPAY_WEBHOOK_SECRET`. Fake or invalid payloads are blocked with a `400 Bad Request`.

---

## Directory Layout

- `/backend`: Express server, TypeScript files, Prisma configuration, SQLite schema, and seeder.
- `/frontend`: Next.js 14+ App Router, Tailwind styles, Chat, and Merchant Dashboard pages.
- `.env.example`: Configuration template.

---

## Setup & Running Locally

### Prerequisites
- Node.js (v18+)
- npm

### 1. Configuration Setup
Create a `.env` file in `/backend` (or copy `.env.example`).
```bash
# In C:\Users\devendar\.gemini\antigravity\scratch\nexus
copy .env.example backend\.env
copy .env.example frontend\.env.local
```

### 2. Install & Start Backend
```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev
```
*The database is now seeded with default policy configurations and 12 mock products (shoes, fitness bands, compression apparel).*

### 3. Install & Start Frontend
In a new terminal window:
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Simulating Failed Payments & Recovery

To test the payment failure recovery pipelines, follow these steps during the checkout flow:

1. **Native Razorpay checkout (if real test keys are in `.env`)**:
   - Select **Card** as the payment method.
   - Enter standard test card details (e.g. `4111 1111 1111 1111`).
   - Click "Pay". In the redirected mock bank emulator page, click the **Failure** button.
   - Alternatively, for **UPI** testing, enter `failure@razorpay` as the UPI ID.
2. **Offline Simulated Checkout (if no keys are in `.env`)**:
   - Click "Confirm Purchase" in the chat window. A modal simulating the payment window will prompt.
   - Click **Simulate Failure**.
3. **Recovery outcome**:
   - The webhook/callback routes register the failure, update the status to `FAILED`, reinstate stock quantities, and prompt the agent to respond.
   - The conversational agent will present a helpful response explaining the authorization failed and offering alternative lower-priced items or retries.

---

## Headless API Live Demonstration (Agent-to-Agent)

To prove that external AI agents can transact programmatically without using our React UI, run these `curl` commands in your terminal:

### Step 1: Discover API Manifest
```bash
curl http://localhost:5000/.well-known/agent-commerce.json
```

### Step 2: Browse Products
```bash
curl http://localhost:5000/api/catalog
```
*Note down a `productId` UUID from the JSON response (e.g., the running shoes).*

### Step 3: Request Quote (Headless)
Request a quote for 1 item with a 10% discount:
```bash
curl -X POST http://localhost:5000/api/agent/quote \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"headless_agent_session_123\",
    \"items\": [{\"productId\": \"PASTE_PRODUCT_UUID_HERE\", \"quantity\": 1}],
    \"discountPercent\": 10
  }"
```

### Step 4: Confirm Checkout (Headless)
Execute the purchase programmatically:
```bash
curl -X POST http://localhost:5000/api/agent/checkout \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"headless_agent_session_123\",
    \"items\": [{\"productId\": \"PASTE_PRODUCT_UUID_HERE\", \"quantity\": 1}],
    \"discountPercent\": 10,
    \"customerName\": \"Headless Machine Caller\"
  }"
```
*Asserts `200 OK` with order database model and Razorpay order ID. You can check the Merchant Dashboard timeline under `/dashboard` to inspect the logged audit entry.*
