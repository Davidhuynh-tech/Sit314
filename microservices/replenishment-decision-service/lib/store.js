/**
 * Pluggable storage adapter for the Replenishment Decision service.
 * In-memory version is seeded with demo data for local testing.
 * DynamoDB version targets the StockLevels table (Task 1, Section 3.2)
 * and a Suppliers lookup (Aurora/DynamoDB) - stubbed for Week 6.
 */

function createInMemoryStore(seedStock = {}) {
  // seedStock: { 'store_1#sku_1': { currentStock, reorderThreshold, supplierLeadTimeDays } }
  const stock = new Map(Object.entries(seedStock));
  const DEFAULT = { currentStock: 50, reorderThreshold: 15, supplierLeadTimeDays: 3 };

  return {
    async getStockInfo(key) {
      return stock.get(key) || { ...DEFAULT };
    },
    async setStockInfo(key, info) {
      stock.set(key, info);
      return info;
    },
  };
}

function createDynamoDbStore(tableNames = { stock: "StockLevels", suppliers: "SuppliersAndOrders" }) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async getStockInfo(key) {
      const res = await client.send(new GetCommand({ TableName: tableNames.stock, Key: { store_id_sku_id: key } }));
      if (!res.Item) throw new Error(`No StockLevels record for ${key} - Week 6 seeding required`);
      return res.Item;
    },
    async setStockInfo(key, info) {
      return client.send(new PutCommand({ TableName: tableNames.stock, Item: { store_id_sku_id: key, ...info } }));
    },
  };
}

module.exports = { createInMemoryStore, createDynamoDbStore };
