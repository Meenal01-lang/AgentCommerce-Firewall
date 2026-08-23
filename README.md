# 🛡️ AgentCommerce Firewall

**The trust layer between AI buyers and your money.**

AI agents are starting to shop on our behalf — but nobody's actually shopping *for* the merchant's sake, or *for* the buyer's safety, when the negotiator on the other end is a language model. AgentCommerce Firewall is what sits in between: it makes a merchant instantly readable and transactable by any AI agent, while guaranteeing that not a single rupee moves without passing through an explainable, bounded, auditable rulebook.

No black-box charges. No runaway discounts. No silent failures. Every action an agent takes is proposed, checked, logged, and explained — in plain language, in real time.

---

## 🚨 The Problem

The next wave of commerce isn't humans clicking "Buy Now" — it's AI agents doing it for them. Protocols like AP2, ACP, and x402 are racing to define how AI-to-merchant transactions should work, and merchants who aren't "agent-ready" will simply become invisible to an entire new category of buyer.

But handing an LLM the ability to move money is terrifying if there's no guardrail. A hallucinated discount, a misread price, a retried request that double-charges — these aren't hypothetical, they're inevitable at scale.

**The real problem isn't "can an AI buy something." It's "can we trust it to."**

---

## 💡 The Solution

AgentCommerce Firewall answers that with three layers working together:

### 1. 🗂️ Agent-Readable Catalog
A structured, machine-queryable endpoint (`/api/catalog` + `/.well-known/agent-commerce.json`) that lets *any* external AI agent — not just our own chatbot — discover what a merchant sells and how to transact with them.

### 2. 💬 Conversational Checkout Agent
A natural-language buying experience where an LLM negotiates, proposes bundles, and quotes prices — but never charges anything without an explicit, visible confirmation step.

### 3. 🔥 The Money Action Firewall
Before *any* discount, charge, or refund reaches Razorpay, it's checked against merchant-defined policy: max discount %, max order value, max refund amount, session spend caps. Violations are blocked immediately, with a human-readable reason — not a silent failure, not a hallucinated bypass.

Every decision — the buyer's request, the agent's reasoning, the policy snapshot applied, the approve/block outcome, and the Razorpay response — is written to a live **Audit Trail** the merchant can watch unfold in real time.

---

## ✨ What Makes This Different

Most agentic-commerce demos do *one* thing — a chatbot, or a discount bot, or a catalog feed. AgentCommerce Firewall is the connective tissue underneath all of them:

| Feature | Why it matters |
|---|---|
| 🔒 **Money Action Firewall** | Every monetary action is gated *before* execution, not audited after the fact |
| 🧠 **Structured Agent Reasoning** | The LLM's decision logic is captured and stored, not just its output |
| 📜 **Policy Snapshotting** | The audit log shows exactly which rules were active at the moment of each decision |
| 💳 **Session Spend Caps** | Blocks the "many small approved transactions" exploit that per-order limits miss |
| 🩹 **Graceful Failure Recovery** | Failed payments don't crash the flow — the agent explains and offers a real recovery path |
| 🌐 **Headless Agent-to-Agent API** | Provably works for *external* AI agents via direct API calls, not just our own UI |
| 🔐 **Webhook Signature Verification** | Payment status updates are cryptographically verified, not blindly trusted |

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────┐
│   Buyer / AI     │◄───────►│   Conversational       │────────►│  Money      │
│   Agent (Chat/    │         │   Checkout Agent        │         │  Action     │
│   Headless API)   │         │   (LLM + Reasoning)      │         │  Firewall   │
└─────────────────┘         └──────────────────────┘         └──────┬──────┘
                                                                        │
                                                                 approved / blocked
                                                                        │
                             ┌──────────────────────┐                  ▼
                             │   Live Audit Trail     │◄────────┌─────────────┐
                             │   & Merchant Dashboard │          │  Razorpay    │
                             └──────────────────────┘          │  (Test Mode) │
                                                                └─────────────┘
```

---

## 🛠️ Tech Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite + Prisma ORM
- **Payments:** Razorpay SDK (Test Mode, with offline mock fallback)
- **AI:** Gemini / OpenAI, wrapped for structured reasoning capture

---

## 🚀 Getting Started

### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Then open:
- 🛒 **Buyer Chat:** `http://localhost:3000`
- 📊 **Merchant Dashboard:** `http://localhost:3000/dashboard`

> Full setup instructions, environment variables, and test flows are in the individual `backend/` and `frontend/` folders.

---

## 🎯 The Bar We Set for Ourselves

> *"Every money action explainable, bounded and gated. Show the audit trail and one failure handled gracefully."*

That line from the brief isn't a checkbox for us — it's the entire architecture. If an AI is going to spend money on someone's behalf, the least it owes them is a reason.

---

## 📄 License

Built for the Razorpay AI Buildathon 2026.
