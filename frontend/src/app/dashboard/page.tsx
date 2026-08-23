'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Product {
  id: string;
  name: string;
  price: number;
}

interface AuditLog {
  id: string;
  sessionId: string;
  timestamp: string;
  buyerMessage: string | null;
  agentReasoning: string;
  actionType: string;
  actionDetails: any; // Parsed from JSON
  policyStatus: 'APPROVED' | 'BLOCKED';
  policyReason: string | null;
  policySnapshot: {
    maxDiscountPercent: number;
    maxSingleOrderVal: number;
    maxRefundAmount: number;
    maxSpendPerSession: number;
    whitelistedUpsell: string;
  };
  apiResponse: any; // Parsed from JSON
}

export default function Dashboard() {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');

  // Dashboard state
  const [activeTab, setActiveTab] = useState<'audit' | 'policy' | 'campaign'>('audit');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  
  // Policy form state
  const [products, setProducts] = useState<Product[]>([]);
  const [policyId, setPolicyId] = useState<string>('singleton');
  const [maxDiscountPercent, setMaxDiscountPercent] = useState<number>(20);
  const [maxSingleOrderVal, setMaxSingleOrderVal] = useState<number>(10000);
  const [maxRefundAmount, setMaxRefundAmount] = useState<number>(5000);
  const [maxSpendPerSession, setMaxSpendPerSession] = useState<number>(25000);
  const [whitelistedIds, setWhitelistedIds] = useState<string[]>([]);
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);
  const [policyMessage, setPolicyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Campaign state
  const [campaignLog, setCampaignLog] = useState<string[]>([]);
  const [campaignRunning, setCampaignRunning] = useState<boolean>(false);

  // Expanded log ID tracking
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Load auth token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('nexus_merchant_token');
    if (savedToken) {
      verifyToken(savedToken);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    verifyToken(tokenInput);
  };

  const verifyToken = async (token: string) => {
    try {
      // Test the token against policy endpoint
      const res = await fetch(`${API_BASE}/api/policy?token=${token}`);
      if (res.ok) {
        localStorage.setItem('nexus_merchant_token', token);
        setAuthenticated(true);
        setAuthError('');
        // Load data
        const policyData = await res.json();
        applyPolicyData(policyData);
        fetchProducts();
        fetchAuditLogs(token);
      } else {
        setAuthError('Invalid Auth Token. Verification failed.');
        localStorage.removeItem('nexus_merchant_token');
      }
    } catch (err) {
      setAuthError('Could not connect to Express backend.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nexus_merchant_token');
    setAuthenticated(false);
    setTokenInput('');
  };

  const applyPolicyData = (policy: any) => {
    setPolicyId(policy.id);
    setMaxDiscountPercent(policy.maxDiscountPercent);
    setMaxSingleOrderVal(policy.maxSingleOrderVal);
    setMaxRefundAmount(policy.maxRefundAmount);
    setMaxSpendPerSession(policy.maxSpendPerSession);
    setWhitelistedIds(policy.whitelistedUpsell ? policy.whitelistedUpsell.split(',') : []);
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/catalog`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } catch (err) {
      console.error('Failed to load products list:', err);
    }
  };

  const fetchAuditLogs = async (tokenOverride?: string) => {
    const token = tokenOverride || localStorage.getItem('nexus_merchant_token') || '';
    setLoadingLogs(true);
    try {
      const res = await fetch(`${API_BASE}/api/audit`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Update policy config
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    setPolicyMessage(null);

    const token = localStorage.getItem('nexus_merchant_token') || '';
    try {
      const res = await fetch(`${API_BASE}/api/policy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          maxDiscountPercent,
          maxSingleOrderVal,
          maxRefundAmount,
          maxSpendPerSession,
          whitelistedUpsell: whitelistedIds.filter(Boolean).join(',')
        })
      });

      if (res.ok) {
        const data = await res.json();
        applyPolicyData(data);
        setPolicyMessage({ type: 'success', text: 'Policy rules updated successfully!' });
      } else {
        const errData = await res.json();
        setPolicyMessage({ type: 'error', text: errData.error || 'Failed to save policy.' });
      }
    } catch (err) {
      setPolicyMessage({ type: 'error', text: 'Failed to communicate with Express server.' });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleToggleWhitelist = (productId: string) => {
    if (whitelistedIds.includes(productId)) {
      setWhitelistedIds(prev => prev.filter(id => id !== productId));
    } else {
      setWhitelistedIds(prev => [...prev, productId]);
    }
  };

  // Campaign Trigger Simulator
  const triggerAbandonedCartCampaign = async () => {
    if (campaignRunning) return;
    setCampaignRunning(true);
    setCampaignLog([]);

    const log = (msg: string) => setCampaignLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    log('Locating high-intent abandoned buyer sessions...');
    await new Promise(r => setTimeout(r, 1000));

    // Create a mock session that left active items
    const mockCampaignSession = `sess_camp_${Math.random().toString(36).substring(2, 7)}`;
    log(`Selected session key: ${mockCampaignSession}`);
    await new Promise(r => setTimeout(r, 800));

    log('Analyzing session cart: Found "Nexus Running Shoes Pro"');
    await new Promise(r => setTimeout(r, 800));

    log('Orchestrator proposing 15% discount campaign nudge...');
    await new Promise(r => setTimeout(r, 600));

    // Call the checkout endpoints headlessly to simulate audit generation
    try {
      const token = localStorage.getItem('nexus_merchant_token') || '';
      
      // Look up shoe UUID
      const shoes = products.find(p => p.name.includes('Running Shoes Pro'));
      if (!shoes) {
        log('Error: Run database seed first to create products.');
        setCampaignRunning(false);
        return;
      }

      log('Evaluating proposed discount through Policy Firewall...');
      
      // Call quote router to trigger policy validation
      const quoteRes = await fetch(`${API_BASE}/api/agent/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId: mockCampaignSession,
          items: [{ productId: shoes.id, quantity: 1 }],
          discountPercent: 15 // Campaign discount
        })
      });

      const quoteData = await quoteRes.json();
      
      if (quoteRes.ok) {
        log('Firewall validation: APPROVED (15% is under limit).');
        log('Simulating push notification message sent to buyer: "We noticed you left shoes in your cart! Confirm purchase now for 15% off."');
      } else {
        log(`Firewall validation: BLOCKED. Reason: ${quoteData.reason}`);
      }

      // Refresh audit timeline to show campaign logs
      fetchAuditLogs();

    } catch (err: any) {
      log(`Campaign execution exception: ${err.message}`);
    } finally {
      setCampaignRunning(false);
    }
  };

  // Format date helper
  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  };

  // RENDER SECURITY GATE IF NOT AUTHENTICATED
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl space-y-4">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Nexus Gateway Admin</h1>
            <p className="text-xs text-neutral-400">Please authenticate to access the Policy and Audit console.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Merchant Access Token</label>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Enter secret token (e.g. nexus-secret-key-2026)"
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-600 focus:outline-none rounded px-3 py-2 text-sm text-neutral-200"
              />
            </div>

            {authError && (
              <p className="text-xs font-semibold text-rose-500 text-center">{authError}</p>
            )}

            <button
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm rounded shadow transition text-white"
            >
              Verify & Unlock
            </button>
          </form>

          <div className="text-center pt-2 border-t border-neutral-800/60">
            <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
              ← Return to Shop Chat
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // AUTHENTICATED RENDER
  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      
      {/* Navbar */}
      <header className="p-4 border-b border-neutral-900 bg-neutral-950 flex justify-between items-center px-6">
        <div className="flex items-center space-x-4">
          <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
            ← Back to Chat UI
          </Link>
          <div className="h-4 w-[1px] bg-neutral-800"></div>
          <span className="text-lg font-bold tracking-wider text-emerald-400 uppercase font-mono">Nexus Merchant Control</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs px-2.5 py-1 text-neutral-400 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 hover:text-rose-400 rounded transition"
        >
          Sign Out
        </button>
      </header>

      {/* Main Grid */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        
        {/* Navigation Tabs (Sidebar) */}
        <nav className="w-full md:w-[220px] bg-neutral-900 border-b md:border-b-0 md:border-r border-neutral-850 p-4 flex md:flex-col space-y-0 md:space-y-2 space-x-2 md:space-x-0">
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex-1 md:flex-none text-left text-xs font-semibold py-2.5 px-3 rounded transition ${activeTab === 'audit' ? 'bg-emerald-600/10 border-l-2 border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-400 hover:bg-neutral-800'}`}
          >
            Live Audit Trail
          </button>
          <button
            onClick={() => setActiveTab('policy')}
            className={`flex-1 md:flex-none text-left text-xs font-semibold py-2.5 px-3 rounded transition ${activeTab === 'policy' ? 'bg-emerald-600/10 border-l-2 border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-400 hover:bg-neutral-800'}`}
          >
            Money Action Firewall
          </button>
          <button
            onClick={() => setActiveTab('campaign')}
            className={`flex-1 md:flex-none text-left text-xs font-semibold py-2.5 px-3 rounded transition ${activeTab === 'campaign' ? 'bg-emerald-600/10 border-l-2 border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-400 hover:bg-neutral-800'}`}
          >
            Campaign Orchestrator
          </button>
        </nav>

        {/* Content Box */}
        <main className="flex-1 p-6 overflow-y-auto">
          
          {/* TAB 1: LIVE AUDIT TRAIL TIMELINE */}
          {activeTab === 'audit' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-950">
                <div>
                  <h2 className="text-lg font-bold text-neutral-200">Merchant Audit Log</h2>
                  <p className="text-xs text-neutral-400">Transcripts of LLM reasoning, policies matched, and payment executions</p>
                </div>
                <button
                  onClick={() => fetchAuditLogs()}
                  className="px-3 py-1 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-xs font-medium text-neutral-300 rounded transition"
                >
                  Refresh Logs
                </button>
              </div>

              {loadingLogs && auditLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-500">Loading audit feed...</div>
              ) : auditLogs.length === 0 ? (
                <div className="p-8 border border-dashed border-neutral-850 rounded text-center text-xs text-neutral-500">
                  No log entries created yet. Interact with the chat bot or trigger simulation to see entries here.
                </div>
              ) : (
                <div className="relative border-l border-neutral-800/80 ml-2.5 pl-6 space-y-6">
                  {auditLogs.map((log) => {
                    const isBlocked = log.policyStatus === 'BLOCKED';
                    return (
                      <div key={log.id} className="relative group">
                        
                        {/* Status Icon Indicator */}
                        <span className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 ${isBlocked ? 'bg-rose-500 border-rose-500' : 'bg-emerald-500 border-emerald-500'}`}></span>

                        <div className="bg-neutral-900 border border-neutral-800/85 rounded-lg p-4 space-y-3 shadow-md hover:border-neutral-700 transition">
                          
                          {/* Log Line Title */}
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-1">
                            <div className="flex items-center space-x-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase ${isBlocked ? 'bg-rose-950 border border-rose-800/50 text-rose-400' : 'bg-emerald-950 border border-emerald-800/50 text-emerald-400'}`}>
                                {log.policyStatus}
                              </span>
                              <span className="font-mono text-xs font-bold text-neutral-300">
                                {log.actionType}
                              </span>
                            </div>
                            <span className="text-[10px] text-neutral-500">{formatDate(log.timestamp)}</span>
                          </div>

                          {/* Snapshot preview snippet */}
                          <p className="text-xs text-neutral-300 leading-relaxed font-mono select-all">
                            Session: <span className="text-neutral-400 font-semibold">{log.sessionId}</span>
                            {log.policyReason && <span className="block text-rose-400 font-semibold mt-1">Rejection: {log.policyReason}</span>}
                          </p>

                          {/* Expandable inspector view button */}
                          <button
                            onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                            className="text-xs text-zinc-500 hover:text-zinc-400 underline font-medium select-none"
                          >
                            {expandedLogId === log.id ? 'Collapse inspector view' : 'Expand reasoning & snapshot details'}
                          </button>

                          {/* Inspector Content */}
                          {expandedLogId === log.id && (
                            <div className="border-t border-neutral-850 mt-3 pt-3 space-y-3 text-xs bg-neutral-950/40 p-3 rounded border border-neutral-850 animate-fade-in font-mono">
                              
                              {/* Buyer Input */}
                              {log.buyerMessage && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Buyer Request Intent:</div>
                                  <div className="p-2 bg-neutral-900 border border-neutral-850 rounded text-neutral-200">
                                    "{log.buyerMessage}"
                                  </div>
                                </div>
                              )}

                              {/* LLM Agent Reasoning (Structured Output) */}
                              <div className="space-y-1">
                                <div className="text-[10px] text-neutral-500 font-semibold uppercase">Captured Agent LLM Reasoning:</div>
                                <div className="p-2.5 bg-neutral-900/60 border border-neutral-850 rounded text-amber-500 font-sans leading-relaxed">
                                  {log.agentReasoning}
                                </div>
                              </div>

                              {/* Action details */}
                              {log.actionDetails && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Action Payload Parameters:</div>
                                  <pre className="p-2 bg-neutral-900/40 border border-neutral-850 rounded text-[11px] text-neutral-400 overflow-x-auto">
                                    {JSON.stringify(log.actionDetails, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {/* Policy Snapshot (Requirement 3: SNAPSHOT ON EVERY AUDIT ENTRY) */}
                              {log.policySnapshot && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Policy Firewall Snapshots (At Instant of Check):</div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] bg-neutral-900 border border-neutral-850 p-2.5 rounded text-neutral-400">
                                    <div>
                                      <span className="block text-neutral-500">Max Discount:</span>
                                      <span className="font-semibold text-neutral-300">{log.policySnapshot.maxDiscountPercent}%</span>
                                    </div>
                                    <div>
                                      <span className="block text-neutral-500">Max Order Val:</span>
                                      <span className="font-semibold text-neutral-300">₹{log.policySnapshot.maxSingleOrderVal}</span>
                                    </div>
                                    <div>
                                      <span className="block text-neutral-500">Max Refund:</span>
                                      <span className="font-semibold text-neutral-300">₹{log.policySnapshot.maxRefundAmount}</span>
                                    </div>
                                    <div>
                                      <span className="block text-neutral-500">Session Spend Limit:</span>
                                      <span className="font-semibold text-neutral-300">₹{log.policySnapshot.maxSpendPerSession}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* API Response payload */}
                              {log.apiResponse && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">API Gateway / Payment Webhook Response Payload:</div>
                                  <pre className="p-2 bg-neutral-900/40 border border-neutral-850 rounded text-[11px] text-neutral-400 overflow-x-auto">
                                    {JSON.stringify(log.apiResponse, null, 2)}
                                  </pre>
                                </div>
                              )}

                            </div>
                          )}

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MONEY ACTION FIREWALL (POLICY ENGINE CONFIG) */}
          {activeTab === 'policy' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-neutral-200">Money Action Firewall Settings</h2>
                <p className="text-xs text-neutral-400">Configure parameters for transaction checks. Changes apply immediately to active sessions.</p>
              </div>

              {policyMessage && (
                <div className={`p-3 rounded text-xs font-semibold ${policyMessage.type === 'success' ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400' : 'bg-rose-950/80 border border-rose-800 text-rose-400'}`}>
                  {policyMessage.text}
                </div>
              )}

              <form onSubmit={handleSavePolicy} className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-4">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-400">Max Discount Allowed (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={maxDiscountPercent}
                      onChange={(e) => setMaxDiscountPercent(parseFloat(e.target.value))}
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-600 focus:outline-none rounded px-3 py-2 text-sm text-neutral-200 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-400">Max Single Order Value (₹)</label>
                    <input
                      type="number"
                      value={maxSingleOrderVal}
                      onChange={(e) => setMaxSingleOrderVal(parseInt(e.target.value))}
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-600 focus:outline-none rounded px-3 py-2 text-sm text-neutral-200 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-400">Max Refund Cap (₹)</label>
                    <input
                      type="number"
                      value={maxRefundAmount}
                      onChange={(e) => setMaxRefundAmount(parseInt(e.target.value))}
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-600 focus:outline-none rounded px-3 py-2 text-sm text-neutral-200 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-400">Max Cumulative Session Spend Limit (₹)</label>
                    <input
                      type="number"
                      value={maxSpendPerSession}
                      onChange={(e) => setMaxSpendPerSession(parseInt(e.target.value))}
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-600 focus:outline-none rounded px-3 py-2 text-sm text-neutral-200 font-mono"
                    />
                  </div>
                </div>

                {/* Whitelist product section */}
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold text-neutral-400 block">Whitelisted Items for Auto-Upselling</label>
                  <div className="border border-neutral-800 bg-neutral-950 rounded divide-y divide-neutral-900 max-h-[160px] overflow-y-auto">
                    {products.map((prod) => (
                      <label key={prod.id} className="flex items-center space-x-3 p-2 hover:bg-neutral-900/50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={whitelistedIds.includes(prod.id)}
                          onChange={() => handleToggleWhitelist(prod.id)}
                          className="rounded bg-neutral-950 border-neutral-800 text-emerald-600 focus:ring-0"
                        />
                        <span className="text-neutral-300 font-medium">{prod.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingPolicy}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 font-semibold text-xs rounded shadow transition text-white uppercase tracking-wider"
                >
                  {savingPolicy ? 'Saving modifications...' : 'Apply firewall settings'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: CAMPAIGN ORCHESTRATOR PANEL */}
          {activeTab === 'campaign' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-neutral-200">Campaign & Engagement Engine</h2>
                <p className="text-xs text-neutral-400">Push automated engagement nudges (e.g. abandoned carts alerts) to sessions. These run through the Policy Firewall.</p>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-4">
                <div className="text-xs text-neutral-400 leading-relaxed">
                  Clicking the button below simulates an asynchronous event where our orchestrator scans the database for "abandoned" user carts and triggers an automated checkout nudger agent offering 15% discount combo codes.
                </div>

                <button
                  onClick={triggerAbandonedCartCampaign}
                  disabled={campaignRunning}
                  className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 font-semibold text-xs text-white rounded transition"
                >
                  {campaignRunning ? 'Orchestrating campaign nudges...' : 'Trigger Abandoned Cart Campaign'}
                </button>

                {campaignLog.length > 0 && (
                  <div className="border border-neutral-800 bg-neutral-950 rounded p-3 text-xs font-mono space-y-1.5 max-h-[220px] overflow-y-auto">
                    <div className="text-[10px] text-neutral-500 font-semibold uppercase border-b border-neutral-900 pb-1 mb-1">
                      Campaign Engine Telemetry Output:
                    </div>
                    {campaignLog.map((logLine, idx) => (
                      <div key={idx} className="text-neutral-300">
                        {logLine}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
