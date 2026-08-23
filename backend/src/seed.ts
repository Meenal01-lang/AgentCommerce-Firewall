import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean existing data
  await prisma.order.deleteMany({});
  await prisma.refund.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.policy.deleteMany({});

  // Seed Products
  const productsData = [
    // Sports & Outdoors
    {
      name: 'Nexus Running Shoes Pro',
      price: 2499.00,
      description: 'High-performance lightweight running shoes with advanced cushioning.',
      tags: 'shoes,sports,running,activewear',
      bundleEligibility: true,
      stock: 50,
    },
    {
      name: 'Trailblazer Trail Shoes',
      price: 3200.00,
      description: 'Rugged outdoor shoes built for tough trail runs and hiking.',
      tags: 'shoes,sports,hiking,outdoor',
      bundleEligibility: true,
      stock: 30,
    },
    {
      name: 'Insulated Water Bottle 1L',
      price: 799.00,
      description: 'Double-walled stainless steel bottle that keeps drinks cold for 24 hours.',
      tags: 'accessories,sports,fitness,gear',
      bundleEligibility: true,
      stock: 100,
    },
    {
      name: 'Active Training Socks (3-Pack)',
      price: 399.00,
      description: 'Moisture-wicking, breathable athletic socks with arch support.',
      tags: 'socks,activewear,apparel,sports',
      bundleEligibility: true,
      stock: 150,
    },
    // Wearables & Electronics
    {
      name: 'Nexus FitBand V4',
      price: 1899.00,
      description: 'Waterproof fitness tracker with heart rate, sleep monitoring, and step counter.',
      tags: 'wearables,electronics,fitness,gadgets',
      bundleEligibility: true,
      stock: 40,
    },
    {
      name: 'AeroPulse Wireless Earbuds',
      price: 2999.00,
      description: 'True wireless sweatproof earbuds optimized for running and intense workouts.',
      tags: 'audio,electronics,gadgets,sports',
      bundleEligibility: true,
      stock: 25,
    },
    {
      name: 'AeroPulse Pro ANC Headphones',
      price: 8999.00,
      description: 'Premium active noise cancelling over-ear headphones with 40h battery life.',
      tags: 'audio,electronics,gadgets,premium',
      bundleEligibility: false,
      stock: 15,
    },
    // Activewear & Apparel
    {
      name: 'UltraDry Compression Shorts',
      price: 699.00,
      description: 'Ergonomic athletic compression shorts for optimal muscle support.',
      tags: 'apparel,activewear,clothing,sports',
      bundleEligibility: true,
      stock: 80,
    },
    {
      name: 'Nexus Windbreaker Jacket',
      price: 1599.00,
      description: 'Wind-resistant and water-repellent jacket for outdoor running.',
      tags: 'apparel,clothing,jacket,outdoor',
      bundleEligibility: true,
      stock: 35,
    },
    {
      name: 'Pro Sweatbands Pack',
      price: 249.00,
      description: 'Elastic cotton sweatbands for wrist and head, ultra-absorbent.',
      tags: 'accessories,apparel,clothing,fitness',
      bundleEligibility: true,
      stock: 200,
    },
    {
      name: 'Nexus Gym Duffle Bag 30L',
      price: 1299.00,
      description: 'Durable gym bag with dedicated shoe compartment and wet pocket.',
      tags: 'accessories,gear,sports,bags',
      bundleEligibility: true,
      stock: 60,
    },
    {
      name: 'AeroDry Running Tee',
      price: 599.00,
      description: 'Ultra-lightweight and breathable athletic t-shirt.',
      tags: 'apparel,clothing,tee,activewear',
      bundleEligibility: true,
      stock: 120,
    }
  ];

  const seededProducts = [];
  for (const prod of productsData) {
    const p = await prisma.product.create({
      data: prod,
    });
    seededProducts.push(p);
  }
  console.log(`Seeded ${seededProducts.length} products.`);

  // Find a couple of accessory items to whitelist for upsell
  // We'll whitelist Insulated Water Bottle, Active Training Socks, and Pro Sweatbands Pack
  const waterBottle = seededProducts.find((p) => p.name.includes('Water Bottle'));
  const socks = seededProducts.find((p) => p.name.includes('Socks'));
  const sweatbands = seededProducts.find((p) => p.name.includes('Sweatbands'));

  const upsellWhitelist = [
    waterBottle?.id || '',
    socks?.id || '',
    sweatbands?.id || ''
  ].filter(Boolean).join(',');

  // Seed default policy
  await prisma.policy.create({
    data: {
      id: 'singleton',
      maxDiscountPercent: 20.0,
      maxSingleOrderVal: 10000.0,
      maxRefundAmount: 5000.0,
      maxSpendPerSession: 25000.0,
      whitelistedUpsell: upsellWhitelist,
    },
  });

  console.log('Seeded default Policy configuration.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
