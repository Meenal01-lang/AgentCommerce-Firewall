-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "bundleEligibility" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "maxDiscountPercent" REAL NOT NULL DEFAULT 20.0,
    "maxSingleOrderVal" REAL NOT NULL DEFAULT 10000.0,
    "maxRefundAmount" REAL NOT NULL DEFAULT 5000.0,
    "maxSpendPerSession" REAL NOT NULL DEFAULT 25000.0,
    "whitelistedUpsell" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "amount" REAL NOT NULL,
    "discountAmount" REAL NOT NULL DEFAULT 0.0,
    "discountPercent" REAL NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT 'Anonymous Buyer',
    "items" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "razorpayRefundId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerMessage" TEXT,
    "agentReasoning" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionDetails" TEXT NOT NULL,
    "policyStatus" TEXT NOT NULL,
    "policyReason" TEXT,
    "policySnapshot" TEXT NOT NULL,
    "apiResponse" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_razorpayOrderId_key" ON "Order"("razorpayOrderId");
