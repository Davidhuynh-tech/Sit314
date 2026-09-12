/**
 * Shared POS/card-reader event generator.
 * Used by the card-reader device, and by the controller's --demo mode.
 */

function pickPromoStores(storeCount, promoChance = 0.2) {
  const promoStores = new Set();
  for (let s = 1; s <= storeCount; s++) {
    if (Math.random() < promoChance) promoStores.add(`store_${s}`);
  }
  return promoStores;
}

function timeOfDayMultiplier() {
  const hour = new Date().getHours();
  if (hour >= 11 && hour <= 13) return 1.6;
  if (hour >= 17 && hour <= 19) return 1.8;
  if (hour >= 0 && hour <= 6) return 0.2;
  return 1.0;
}

function buildCardSwipe(storeId, skuCount, promoStores) {
  const skuId = `sku_${Math.floor(Math.random() * skuCount) + 1}`;
  return {
    store_id: storeId,
    sku_id: skuId,
    quantity_sold: Math.floor(Math.random() * 3) + 1,
    unit_price: +(Math.random() * 8 + 1).toFixed(2),
    promo_active: promoStores.has(storeId),
    timestamp: new Date().toISOString(),
  };
}

module.exports = { pickPromoStores, timeOfDayMultiplier, buildCardSwipe };
