/**
 * Replenishment decision logic - Week 5 per the Task 1 plan.
 * Compares the forecast against current stock and supplier lead time to
 * decide whether to order, and how much.
 */

/**
 * @param {Object} input
 * @param {number} input.forecastQuantity - predicted demand per day (from Forecasting service)
 * @param {number} input.currentStock - current stock for this store-SKU
 * @param {number} input.reorderThreshold - stock level below which we must act regardless of forecast
 * @param {number} input.supplierLeadTimeDays - days until a new order would arrive
 * @param {number} [input.safetyStockDays=2] - extra buffer days of stock to hold beyond lead time
 * @returns {{shouldOrder:boolean, orderQuantity:number, reason:string}}
 */
function decideReplenishment({
  forecastQuantity,
  currentStock,
  reorderThreshold,
  supplierLeadTimeDays,
  safetyStockDays = 2,
}) {
  // Expected demand between now and when a fresh order would arrive, plus buffer.
  const demandDuringLeadTime = forecastQuantity * (supplierLeadTimeDays + safetyStockDays);
  const projectedStockAtArrival = currentStock - demandDuringLeadTime;

  const hardThresholdBreached = currentStock <= reorderThreshold;
  const projectedStockout = projectedStockAtArrival < 0;

  if (hardThresholdBreached || projectedStockout) {
    const orderQuantity = Math.max(0, Math.ceil(demandDuringLeadTime - currentStock + reorderThreshold));
    return {
      shouldOrder: orderQuantity > 0,
      orderQuantity,
      reason: hardThresholdBreached ? "current_stock_at_or_below_threshold" : "projected_stockout_before_lead_time_elapses",
    };
  }

  return { shouldOrder: false, orderQuantity: 0, reason: "sufficient_stock" };
}

module.exports = { decideReplenishment };
