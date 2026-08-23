import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import catalogRouter from './routes/catalog';
import checkoutRouter from './routes/checkout';
import policyRouter from './routes/policy';
import auditRouter from './routes/audit';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend requests
app.use(cors({
  origin: '*', // In development allow all; can restrict to Next.js host later
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-nexus-token'],
}));

// Configure body-parser to preserve raw body buffer for Razorpay Webhook validation
app.use(
  bodyParser.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(bodyParser.urlencoded({ extended: true }));

// Root route for API diagnostics
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Nexus Merchant Gateway API',
    time: new Date().toISOString(),
  });
});

// Register routers
// Register catalog router at root level to properly expose the /.well-known/ route
app.use(catalogRouter);
// Register checkout, policy, and audit routers under /api namespace (checkout router paths include /api already)
app.use('/api', checkoutRouter);
app.use('/api', policyRouter);
app.use('/api', auditRouter);

// Start server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`  Nexus Express backend running on port ${PORT} `);
  console.log(`=================================================`);
});
