/**
 * Shared shelf-weight/RFID reading generator.
 * Used by the micro-sensor device, and by the controller's --demo mode
 * (which simulates devices internally when no real broker/devices are
 * available, e.g. for local testing of the controller in isolation).
 */

function createShelfState(storeCount, skuCount) {
  const state = {};
  for (let s = 1; s <= storeCount; s++) {
    for (let k = 1; k <= skuCount; k++) {
      state[`store_${s}#sku_${k}`] = {
        storeId: `store_${s}`,
        skuId: `sku_${k}`,
        quantity: Math.floor(Math.random() * 80) + 20,
      };
    }
  }
  return state;
}

function nextShelfReading(state, key) {
  const item = state[key];
  const roll = Math.random();
  let delta;
  if (roll < 0.7) delta = -Math.floor(Math.random() * 3);
  else if (roll < 0.92) delta = -Math.floor(Math.random() * 8) - 3;
  else delta = Math.floor(Math.random() * 40) + 10;

  item.quantity = Math.max(0, item.quantity + delta);
  return {
    store_id: item.storeId,
    sku_id: item.skuId,
    quantity: item.quantity,
    unit: "each",
    reading_type: "shelf_weight",
    timestamp: new Date().toISOString(),
  };
}

module.exports = { createShelfState, nextShelfReading };
