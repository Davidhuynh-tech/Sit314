function createInMemoryStore() {
  const salesHistory = new Map(); // key: `${store_id}#${sku_id}` -> number[]
  const forecasts = new Map();    // key -> forecast object
  const ROLLING_WINDOW = 30;      // keep last 30 observations per store-SKU

  return {
    async appendSale(key, quantity) {
      const arr = salesHistory.get(key) || [];
      arr.push(quantity);
      if (arr.length > ROLLING_WINDOW) arr.shift();
      salesHistory.set(key, arr);
      return arr;
    },
    async getHistory(key) {
      return salesHistory.get(key) || [];
    },
    async saveForecast(key, forecast) {
      forecasts.set(key, forecast);
      return forecast;
    },
    async getForecast(key) {
      return forecasts.get(key);
    },
    _dump() {
      return { salesHistory: Object.fromEntries(salesHistory), forecasts: Object.fromEntries(forecasts) };
    },
  };
}

function createFileStore() {
  const { createJsonTable } = require("../../../shared/jsonTable");
  const sales = createJsonTable("sales-events.json");
  const forecasts = createJsonTable("forecast-results.json");
  const ROLLING_WINDOW = 30;

  return {
    async appendSale(key, quantity) {
      return sales.update(key, (arr) => {
        const next = Array.isArray(arr) ? arr.slice() : [];
        next.push(quantity);
        if (next.length > ROLLING_WINDOW) next.shift();
        return next;
      });
    },
    async getHistory(key) {
      const history = await sales.get(key);
      return Array.isArray(history) ? history : [];
    },
    async saveForecast(key, forecast) {
      return forecasts.put(key, { ...forecast, updated_at: new Date().toISOString() });
    },
    async getForecast(key) {
      return forecasts.get(key);
    },
  };
}

function createDynamoDbStore(tableNames = { history: "SalesEvents", forecast: "ForecastResults" }) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async appendSale(key, quantity) {
      const [store_id, sku_id] = key.split("#");
      return client.send(new PutCommand({
        TableName: tableNames.history,
        Item: { store_id_sku_id: key, timestamp: `${new Date().toISOString()}#${Math.random().toString(16).slice(2)}`, store_id, sku_id, quantity },
      }));
    },
    async getHistory(key) {
      const res = await client.send(new QueryCommand({
        TableName: tableNames.history,
        KeyConditionExpression: "store_id_sku_id = :k",
        ExpressionAttributeValues: { ":k": key },
        ScanIndexForward: false,
        Limit: 30,
      }));
      return (res.Items || []).map((i) => i.quantity).reverse();
    },
    async saveForecast(key, forecast) {
      return client.send(new PutCommand({
        TableName: tableNames.forecast,
        Item: { store_id_sku_id: key, updated_at: new Date().toISOString(), ...forecast },
      }));
    },
    async getForecast(key) {
      const res = await client.send(new GetCommand({
        TableName: tableNames.forecast,
        Key: { store_id_sku_id: key },
      }));
      return res.Item || null;
    },
  };
}

module.exports = { createInMemoryStore, createFileStore, createDynamoDbStore };
