'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  tags: string;
  bundleEligibility: boolean;
  stock: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  quote?: {
    items: Array<{ productId: string; name: string; price: number; quantity: number; itemTotal: number }>;
    subtotal: number;
    discountAmount: number;
    discountPercent: number;
    totalAmount: number;
    reason?: string;
  };
  refund?: {
    orderId: string;
    amount: number;
    reason: string;
  };
  isPaymentTriggered?: boolean;
  orderId?: string;
  paymentStatus?: 'PAID' | 'FAILED' | 'PENDING';
}

interface TelemetryStep {
  endpoint: string;
  method: string;
  payload?: any;
  response?: any;
  status: number;
}

export default function Home() {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);

  // Simulated Payment Modal state
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [pendingOrderDetails, setPendingOrderDetails] = useState<any>(null);

  // Agent-to-Agent Simulator state
  const [showSimulator, setShowSimulator] = useState<boolean>(false);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simulatorLogs, setSimulatorLogs] = useState<TelemetryStep[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // 1. Generate session ID and load catalog on mount
  useEffect(() => {
    let id = localStorage.getItem('nexus_buyer_session');
    if (!id) {
      id = `sess_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem('nexus_buyer_session', id);
    }
    setSessionId(id);
    fetchCatalog();

    // Setup initial welcome message from the agent
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Welcome to **Nexus Smart Store**! I am your conversational shopping assistant. 

Feel free to browse our shoes, fitness bands, wireless earbuds, or compression shorts. 

Try asking:
- *"Show me running shoes under 3000, any bundle deals?"*
- *"Can I get a discount on the Pro Running Shoes?"*`,
        reasoning: 'Greet user, introduce capabilities, and prompt for query.'
      }
    ]);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch(`${API_BASE}/api/catalog`);
      if (res.ok) {
        const data = await res.json();
        setCatalog(data);
      }
    } catch (err) {
      console.error('Failed to load catalog:', err);
    } finally {
      setLoadingCatalog(false);
    }
  };

  // 2. Chat agent interaction
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsgText = input;
    setInput('');
    const userMsgId = `msg_${Date.now()}`;
    
    // Add user message to state
    const updatedMessages = [
      ...messages,
      { id: userMsgId, role: 'user' as const, content: userMsgText }
    ];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      // Map history for LLM backend
      const history = updatedMessages
        .slice(1, -1) // omit welcome and current user message
        .map(m => ({
          role: m.role,
          content: m.content
        }));

      const res = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: userMsgText,
          history
        })
      });

      if (!res.ok) throw new Error('Failed to run agent chat');
      const data = await res.json(); // returns { reasoning, action, params }

      const assistantMsgId = `msg_${Date.now() + 1}`;
      let newMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: data.reasoning
      };

      if (data.action === 'MESSAGE') {
        newMsg.content = data.params.text;
      } else if (data.action === 'QUOTE') {
        newMsg.content = `I've prepared a quote for you. Please confirm the items and discount below:`;
        
        // Fetch pricing breakdown from quote endpoint to display nicely
        try {
          const qRes = await fetch(`${API_BASE}/api/agent/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              items: data.params.items,
              discountPercent: data.params.discountPercent || 0
            })
          });
          if (qRes.ok) {
            newMsg.quote = await qRes.json();
          } else {
            const errData = await qRes.json();
            newMsg.content = `⚠️ **Firewall Rejection**: ${errData.reason || 'Requested quote violated store policy limit.'}`;
          }
        } catch (err) {
          newMsg.content = `Failed to build quote details.`;
        }
      } else if (data.action === 'REFUND') {
        newMsg.content = `I will process a refund of **₹${data.params.amount}** for Order **${data.params.orderId}**. Checking limits...`;
        newMsg.refund = {
          orderId: data.params.orderId,
          amount: data.params.amount,
          reason: data.params.reason
        };
      }

      setMessages(prev => [...prev, newMsg]);

      // If it's a refund, trigger refund validation automatically
      if (data.action === 'REFUND' && newMsg.refund) {
        executeRefund(newMsg.refund);
      }

    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I couldn\'t communicate with my brain server. Please make sure the Express backend is running on port 5000.',
          reasoning: 'Error during connection to API_BASE.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 3. Confirm quote -> Checkout Order creation
  const handleConfirmQuote = async (msgId: string, quote: any) => {
    // Disable quote button to prevent multi-triggering
    setMessages(prev =>
      prev.map(m => (m.id === msgId ? { ...m, isPaymentTriggered: true } : m))
    );

    try {
      const itemsPayload = quote.items.map((it: any) => ({
        productId: it.productId,
        quantity: it.quantity
      }));

      const res = await fetch(`${API_BASE}/api/agent/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          items: itemsPayload,
          discountPercent: quote.discountPercent,
          customerName: 'Nexus Web Buyer'
        })
      });

      const data = await res.json();

      if (!res.ok) {
        // Policy Firewall rejection!
        setMessages(prev =>
          prev.map(m =>
            m.id === msgId
              ? {
                  ...m,
                  paymentStatus: 'FAILED',
                  content: `❌ **Firewall Blocked Checkout**\n\n**Reason:** ${data.reason || 'Monetary action firewall restriction.'}`
                }
              : m
          )
        );
        fetchCatalog(); // Refresh stock
        return;
      }

      // Order created successfully
      const order = data.order;
      
      if (data.isMock) {
        // Run Simulated modal if mock sandbox
        setPendingOrderDetails(data);
        setShowPaymentModal(true);
        // Link message element to pending status
        setMessages(prev =>
          prev.map(m => (m.id === msgId ? { ...m, orderId: order.id, paymentStatus: 'PENDING' } : m))
        );
      } else {
        // Launch real Razorpay SDK payment screen
        launchRazorpayCheckout(data, msgId);
      }

    } catch (err) {
      console.error(err);
      alert('Checkout failed to initialize.');
    }
  };

  // 4. Launch Razorpay payment sheet
  const launchRazorpayCheckout = (rzpData: any, msgId: string) => {
    const { order, keyId } = rzpData;

    const options = {
      key: keyId,
      amount: Math.round(order.amount * 100),
      currency: 'INR',
      name: 'Nexus Shop',
      description: `Checkout Order Ref: ${order.id.substring(0, 8)}`,
      order_id: order.razorpayOrderId,
      handler: async function (response: any) {
        // Success payment path
        await handlePaymentComplete(order.id, response.razorpay_payment_id, 'success', msgId);
      },
      modal: {
        ondismiss: async function () {
          // Failure payment path / cancellation
          await handlePaymentComplete(order.id, null, 'failed', msgId);
        }
      },
      prefill: {
        name: 'Nexus Buyer',
        email: 'buyer@nexusagent.com'
      },
      theme: {
        color: '#10b981' // emerald-500
      }
    };

    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', async function (response: any) {
      console.error('Payment failure event:', response.error);
      await handlePaymentComplete(order.id, response.error.metadata.payment_id, 'failed', msgId);
    });
    rzp.open();
  };

  // 5. Payment completion sync (both mock and real Razorpay callback)
  const handlePaymentComplete = async (
    orderId: string,
    paymentId: string | null,
    status: 'success' | 'failed',
    msgId: string
  ) => {
    try {
      const res = await fetch(`${API_BASE}/api/agent/payment-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          razorpayPaymentId: paymentId || '',
          status
        })
      });

      if (res.ok) {
        setMessages(prev =>
          prev.map(m =>
            m.id === msgId
              ? {
                  ...m,
                  paymentStatus: status === 'success' ? 'PAID' : 'FAILED',
                  content: status === 'success' 
                    ? `🎉 **Payment Verified Successfully!**\n\nOrder ID: \`${orderId}\`\nRazorpay Payment Ref: \`${paymentId || 'Simulated'}\`\n\nChecking for bundle cross-sells...`
                    : `⚠️ **Payment Failed**\n\nPayment authorization failed or was cancelled. Stock has been reinstated.`
                }
              : m
          )
        );

        // Fetch catalog to show updated stock levels
        fetchCatalog();

        // 6. After payment process, let the agent react
        // We trigger an automated follow-up query to prompt cross-sell or failure recovery
        setTimeout(() => {
          triggerAgentFollowup(status, orderId);
        }, 1500);

      }
    } catch (err) {
      console.error('Failed to sync payment status:', err);
    }
  };

  const triggerAgentFollowup = async (paymentStatus: 'success' | 'failed', orderId: string) => {
    setLoading(true);
    const triggerMessage = paymentStatus === 'success'
      ? `SYSTEM_NOTIFICATION: Order ${orderId} was paid successfully. Recommend a complementary accessory product from the catalog that is whitelisted in policy (e.g. active socks or water bottle).`
      : `SYSTEM_NOTIFICATION: Payment for order ${orderId} failed. Explain to the customer that the payment did not complete, and propose a retry or offer to downgrade to a lower-cost option.`;

    try {
      const res = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: triggerMessage,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (res.ok) {
        const data = await res.json();
        let newMsg: Message = {
          id: `followup_${Date.now()}`,
          role: 'assistant',
          content: '',
          reasoning: data.reasoning
        };

        if (data.action === 'MESSAGE') {
          newMsg.content = data.params.text;
        } else if (data.action === 'QUOTE') {
          newMsg.content = `I can propose this item as a follow-up:`;
          const qRes = await fetch(`${API_BASE}/api/agent/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              items: data.params.items,
              discountPercent: data.params.discountPercent || 0
            })
          });
          if (qRes.ok) {
            newMsg.quote = await qRes.json();
          } else {
            const errData = await qRes.json();
            newMsg.content = `⚠️ **Firewall Rejection**: ${errData.reason}`;
          }
        }
        setMessages(prev => [...prev, newMsg]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 7. Request Refund (Agent triggered)
  const executeRefund = async (refundDetails: any) => {
    try {
      const token = localStorage.getItem('nexus_merchant_token') || 'nexus-secret-key-2026';
      const res = await fetch(`${API_BASE}/api/agent/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // Simulated authorization bypass or saved token
        },
        body: JSON.stringify(refundDetails)
      });

      const data = await res.json();

      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (res.ok) {
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              content: `✅ **Refund Successful**\n\nRefund of **₹${refundDetails.amount}** for order \`${refundDetails.orderId}\` processed.\nRefund ID: \`${data.refundId}\``
            }
          ];
        } else {
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              content: `❌ **Refund Firewall Blocked**\n\n**Reason:** ${data.reason || 'Failed to refund.'}`
            }
          ];
        }
      });
      fetchCatalog(); // Refresh stocks in case items are returned
    } catch (err) {
      console.error(err);
    }
  };

  // 8. Headless Agent-to-Agent simulator
  const runAgentToAgentSimulation = async () => {
    if (simulating) return;
    setSimulating(true);
    setSimulatorLogs([]);
    setShowSimulator(true);

    const logStep = (step: TelemetryStep) => {
      setSimulatorLogs(prev => [...prev, step]);
    };

    try {
      // Step 1: Discover API via well-known manifest
      logStep({
        endpoint: '/.well-known/agent-commerce.json',
        method: 'GET',
        status: 100 // Loading
      });

      const manifestRes = await fetch(`${API_BASE}/.well-known/agent-commerce.json`);
      const manifest = await manifestRes.json();
      logStep({
        endpoint: '/.well-known/agent-commerce.json',
        method: 'GET',
        response: manifest,
        status: manifestRes.status
      });

      // Step 2: Browse Catalog
      const browseEndpoint = manifest.actions.browseCatalog.endpoint;
      logStep({
        endpoint: browseEndpoint.replace(API_BASE, ''),
        method: manifest.actions.browseCatalog.method,
        status: 100
      });

      const catRes = await fetch(browseEndpoint);
      const catProducts = await catRes.json();
      logStep({
        endpoint: browseEndpoint.replace(API_BASE, ''),
        method: manifest.actions.browseCatalog.method,
        response: catProducts,
        status: catRes.status
      });

      // Find the running shoes
      const shoes = catProducts.find((p: any) => p.tags.includes('shoes'));
      if (!shoes) throw new Error('No shoes found in catalog for simulation.');

      // Step 3: Request Quote with discount
      const quoteEndpoint = manifest.actions.requestQuote.endpoint;
      const quotePayload = {
        sessionId: `sim_${Math.random().toString(36).substring(2, 11)}`,
        items: [{ productId: shoes.id, quantity: 1 }],
        discountPercent: 10 // Propose 10% discount
      };

      logStep({
        endpoint: quoteEndpoint.replace(API_BASE, ''),
        method: manifest.actions.requestQuote.method,
        payload: quotePayload,
        status: 100
      });

      const quoteRes = await fetch(quoteEndpoint, {
        method: manifest.actions.requestQuote.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotePayload)
      });
      const quoteData = await quoteRes.json();
      
      logStep({
        endpoint: quoteEndpoint.replace(API_BASE, ''),
        method: manifest.actions.requestQuote.method,
        response: quoteData,
        status: quoteRes.status
      });

      if (!quoteRes.ok) throw new Error('Quote rejected by firewall during simulation.');

      // Step 4: Confirm Checkout
      const checkoutEndpoint = manifest.actions.confirmCheckout.endpoint;
      const checkoutPayload = {
        sessionId: quotePayload.sessionId,
        items: quotePayload.items,
        discountPercent: quotePayload.discountPercent,
        customerName: 'Headless Agent Caller'
      };

      logStep({
        endpoint: checkoutEndpoint.replace(API_BASE, ''),
        method: manifest.actions.confirmCheckout.method,
        payload: checkoutPayload,
        status: 100
      });

      const checkoutRes = await fetch(checkoutEndpoint, {
        method: manifest.actions.confirmCheckout.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutPayload)
      });
      const checkoutData = await checkoutRes.json();

      logStep({
        endpoint: checkoutEndpoint.replace(API_BASE, ''),
        method: manifest.actions.confirmCheckout.method,
        response: checkoutData,
        status: checkoutRes.status
      });

      fetchCatalog(); // Refresh catalog stock levels

    } catch (err: any) {
      console.error(err);
      logStep({
        endpoint: 'SIMULATION_ERROR',
        method: 'FAIL',
        response: { error: err.message },
        status: 500
      });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-screen">
      
      {/* 1. Left Catalog & Telemetry Sidebar */}
      <aside className="w-full md:w-[380px] bg-neutral-900 border-b md:border-b-0 md:border-r border-neutral-800 flex flex-col p-4 space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center space-x-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xl font-bold tracking-tight text-neutral-100">Nexus Gateway</span>
          </div>
          <Link
            href="/dashboard"
            className="text-xs px-2.5 py-1 bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300 rounded font-medium transition"
          >
            Dashboard →
          </Link>
        </div>

        {/* Diagnostic Panel */}
        <div className="bg-neutral-950 border border-neutral-800 rounded p-3 text-xs space-y-2">
          <div className="text-neutral-400 font-semibold uppercase tracking-wider text-[10px]">Session Status</div>
          <div className="flex justify-between">
            <span className="text-neutral-500">API Endpoint:</span>
            <span className="font-mono text-emerald-400">{API_BASE}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-neutral-500">Session ID:</span>
            <span className="font-mono text-neutral-300 select-all font-semibold max-w-[150px] truncate">{sessionId}</span>
          </div>
        </div>

        {/* Headless Agent-to-Agent Simulator Button & Output */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-neutral-300">Agent-to-Agent Purchase Simulator</h3>
          <button
            onClick={runAgentToAgentSimulation}
            disabled={simulating}
            className="w-full text-xs py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-neutral-800 disabled:to-neutral-800 text-white font-semibold rounded shadow transition flex items-center justify-center space-x-2"
          >
            {simulating ? (
              <>
                <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Negotiating...</span>
              </>
            ) : (
              <span>Simulate Headless Machine Purchase</span>
            )}
          </button>

          {showSimulator && (
            <div className="border border-neutral-800 bg-neutral-950 rounded p-2.5 text-[11px] font-mono space-y-2 max-h-[220px] overflow-y-auto">
              <div className="flex justify-between border-b border-neutral-900 pb-1 mb-1 font-semibold text-neutral-400">
                <span>Endpoint Telemetry Log</span>
                <button onClick={() => setShowSimulator(false)} className="hover:text-red-400">Close</button>
              </div>
              {simulatorLogs.map((log, idx) => (
                <div key={idx} className="border-b border-neutral-900 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-neutral-400">
                    <span>
                      <span className="text-emerald-500">[{log.method}]</span> {log.endpoint}
                    </span>
                    <span className={log.status === 100 ? 'text-amber-500 animate-pulse' : log.status < 300 ? 'text-emerald-400' : 'text-red-400'}>
                      {log.status === 100 ? '...' : log.status}
                    </span>
                  </div>
                  {log.payload && (
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      REQ: {JSON.stringify(log.payload)}
                    </div>
                  )}
                  {log.response && (
                    <div className="text-[10px] text-zinc-400 overflow-x-auto max-h-[80px] mt-0.5 p-1 bg-neutral-900 rounded">
                      <pre>{JSON.stringify(log.response, null, 1)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Catalog List */}
        <div className="flex-1 flex flex-col min-h-0 space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-neutral-300">Catalog Storefront</h3>
            <button onClick={fetchCatalog} className="text-[10px] text-neutral-400 hover:text-emerald-400 transition">
              Refresh Stock
            </button>
          </div>

          <div className="flex-1 overflow-y-auto border border-neutral-800 bg-neutral-950 rounded divide-y divide-neutral-900 pr-1 max-h-[300px] md:max-h-none">
            {loadingCatalog && catalog.length === 0 ? (
              <div className="p-4 text-center text-xs text-neutral-500">Loading catalog...</div>
            ) : catalog.length === 0 ? (
              <div className="p-4 text-center text-xs text-neutral-500">Catalog empty or backend disconnected.</div>
            ) : (
              catalog.map((prod) => (
                <div key={prod.id} className="p-2.5 text-xs hover:bg-neutral-900/50 transition">
                  <div className="flex justify-between items-start font-medium">
                    <span className="text-neutral-200">{prod.name}</span>
                    <span className="text-emerald-400 font-semibold font-mono">₹{prod.price}</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-0.5 line-clamp-2">{prod.description}</p>
                  <div className="flex justify-between items-center mt-1 text-[10px]">
                    <span className="text-neutral-500 max-w-[180px] truncate">Tags: {prod.tags}</span>
                    <span className={prod.stock > 0 ? 'text-neutral-400' : 'text-rose-500 font-bold'}>
                      {prod.stock > 0 ? `${prod.stock} left` : 'Out of Stock'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* 2. Right Conversational Chat Area */}
      <main className="flex-1 flex flex-col bg-neutral-950">
        
        {/* Active conversation Header */}
        <header className="p-4 border-b border-neutral-900 flex justify-between items-center bg-neutral-950 z-10">
          <div>
            <h2 className="text-sm font-bold text-neutral-200">Customer Support Chat</h2>
            <p className="text-xs text-neutral-400">Powered by policy-checked LLM reasoning agent</p>
          </div>
          <button
            onClick={() => {
              if (confirm('Clear chat history and reset session?')) {
                setMessages([messages[0]]);
                const newId = `sess_${Math.random().toString(36).substring(2, 11)}`;
                localStorage.setItem('nexus_buyer_session', newId);
                setSessionId(newId);
              }
            }}
            className="text-xs text-neutral-500 hover:text-rose-400 transition"
          >
            Reset Thread
          </button>
        </header>

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-1 max-w-[90%] md:max-w-[80%] mx-auto lg:mx-0">
              
              {/* Message Header */}
              <div className={`text-[10px] font-semibold tracking-wider uppercase text-neutral-500 flex items-center space-x-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <span>{msg.role === 'user' ? 'Buyer Session' : 'Nexus Bot Assistant'}</span>
              </div>

              {/* Message Box */}
              <div className={`p-3.5 rounded-lg text-sm leading-relaxed ${msg.role === 'user' ? 'bg-neutral-800 text-neutral-100 ml-auto border border-neutral-700 max-w-fit' : 'bg-neutral-900 text-neutral-200 border border-neutral-800'}`}>
                
                {/* Content */}
                <div className="whitespace-pre-line text-neutral-200 prose prose-invert max-w-none">
                  {msg.content}
                </div>

                {/* Structured Reasoning Accordion (Only for Assistant replies) */}
                {msg.role === 'assistant' && msg.reasoning && (
                  <details className="mt-2.5 border-t border-neutral-800/80 pt-2 text-xs">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-400 select-none font-semibold flex items-center">
                      <span>🤖 Agent Reasoning Snippet</span>
                    </summary>
                    <div className="mt-1.5 p-2 bg-neutral-950 border border-neutral-800/60 rounded text-neutral-400 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                      {msg.reasoning}
                    </div>
                  </details>
                )}

                {/* Quote Confirmation Component */}
                {msg.role === 'assistant' && msg.quote && (
                  <div className="mt-3 bg-neutral-950 border border-neutral-800 rounded p-3 space-y-2">
                    <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Purchase Quote Summary</div>
                    <div className="divide-y divide-neutral-900">
                      {msg.quote.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs py-1 text-neutral-400">
                          <span>{item.name} (x{item.quantity})</span>
                          <span className="font-mono">₹{item.itemTotal}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-neutral-900 pt-2 space-y-1 text-xs">
                      <div className="flex justify-between text-neutral-500">
                        <span>Subtotal:</span>
                        <span className="font-mono">₹{msg.quote.subtotal}</span>
                      </div>
                      {msg.quote.discountPercent > 0 && (
                        <div className="flex justify-between text-emerald-500">
                          <span>Discount Applied ({msg.quote.discountPercent}%):</span>
                          <span className="font-mono">-₹{msg.quote.discountAmount}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-neutral-200 text-sm pt-1 border-t border-neutral-900">
                        <span>Total Pay Amount:</span>
                        <span className="font-mono text-emerald-400">₹{msg.quote.totalAmount}</span>
                      </div>
                    </div>

                    {msg.quote.reason && (
                      <div className="text-[10px] text-neutral-500 italic">
                        Quote context: {msg.quote.reason}
                      </div>
                    )}

                    {/* Action buttons */}
                    {!msg.isPaymentTriggered ? (
                      <button
                        onClick={() => handleConfirmQuote(msg.id, msg.quote)}
                        className="w-full mt-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded transition flex items-center justify-center space-x-1"
                      >
                        <span>Confirm ₹{msg.quote.totalAmount} Purchase</span>
                      </button>
                    ) : (
                      <div className="mt-2 text-center text-xs py-1.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                        {msg.paymentStatus === 'PAID' && <span className="text-emerald-500 font-bold">✓ Transaction Successful</span>}
                        {msg.paymentStatus === 'FAILED' && <span className="text-rose-500 font-bold">✗ Transaction Failed/Blocked</span>}
                        {msg.paymentStatus === 'PENDING' && <span className="text-amber-500 font-bold animate-pulse">Payment Authorization Pending</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loader */}
          {loading && (
            <div className="flex space-x-2 items-center p-3 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-neutral-500 max-w-[200px]">
              <svg className="animate-spin h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Agent is thinking...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-neutral-900 bg-neutral-950 flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Type your message here (e.g., 'Buy active shoes under 3000')"
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 text-neutral-100 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 text-white font-semibold text-sm rounded shadow transition"
          >
            Send
          </button>
        </form>
      </main>

      {/* 3. Simulated Razorpay Checkout Modal (Sandbox offline mode fallback) */}
      {showPaymentModal && pendingOrderDetails && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-sm w-full p-5 shadow-2xl space-y-4">
            
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
              <h3 className="text-md font-bold text-neutral-200">Razorpay Checkout Sandbox</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-neutral-800 text-neutral-400 rounded uppercase">TEST MODE</span>
            </div>

            <div className="space-y-2 text-xs text-neutral-300">
              <p>Simulating sandbox payment for order reference: <span className="font-mono text-emerald-400">{pendingOrderDetails.order.id.substring(0, 12)}...</span></p>
              <div className="bg-neutral-950 p-2.5 rounded font-mono space-y-1.5 border border-neutral-800">
                <div className="flex justify-between">
                  <span>Payee:</span>
                  <span className="text-neutral-400">Nexus Smart Store</span>
                </div>
                <div className="flex justify-between">
                  <span>Order ID:</span>
                  <span className="text-neutral-400 truncate max-w-[150px]">{pendingOrderDetails.order.razorpayOrderId}</span>
                </div>
                <div className="flex justify-between font-bold text-neutral-200 mt-1 pt-1 border-t border-neutral-900">
                  <span>Amount Due:</span>
                  <span>₹{pendingOrderDetails.order.amount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={async () => {
                  setShowPaymentModal(false);
                  const mockPayId = `pay_mock_success_${Math.random().toString(36).substring(2, 11)}`;
                  // Find the target message element ID to update in UI
                  const targetMsg = messages.find(m => m.orderId === pendingOrderDetails.order.id || (m.quote && Math.abs(m.quote.totalAmount - pendingOrderDetails.order.amount) < 0.01 && m.paymentStatus === 'PENDING'));
                  const msgId = targetMsg ? targetMsg.id : messages[messages.length - 1].id;
                  await handlePaymentComplete(pendingOrderDetails.order.id, mockPayId, 'success', msgId);
                }}
                className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded shadow transition text-center"
              >
                Simulate Success
              </button>
              <button
                onClick={async () => {
                  setShowPaymentModal(false);
                  const mockPayId = `pay_mock_fail_${Math.random().toString(36).substring(2, 11)}`;
                  const targetMsg = messages.find(m => m.orderId === pendingOrderDetails.order.id || (m.quote && Math.abs(m.quote.totalAmount - pendingOrderDetails.order.amount) < 0.01 && m.paymentStatus === 'PENDING'));
                  const msgId = targetMsg ? targetMsg.id : messages[messages.length - 1].id;
                  await handlePaymentComplete(pendingOrderDetails.order.id, mockPayId, 'failed', msgId);
                }}
                className="py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded shadow transition text-center"
              >
                Simulate Failure
              </button>
            </div>
            
            <div className="text-[10px] text-center text-neutral-500">
              This modal appears because no real Razorpay Keys were configured in backend .env, or mock mode was triggered.
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
