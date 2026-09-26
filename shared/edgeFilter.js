/**
 * Edge deadband filter.
 * Shelf readings are relayed only when they are new, move by at least
 * `deadband` units, or cross the reorder threshold. POS sales are not
 * passed through this filter.
 */
function createEdgeFilter({ deadband = 5, reorderThreshold = 15 } = {}) {
  const lastRelayed = new Map();
  const stats = { seen: 0, relayed: 0, suppressed: 0 };

  return {
    shouldRelayShelf(reading) {
      stats.seen += 1;
      if (!deadband) {
        stats.relayed += 1;
        return true;
      }
      const key = `${reading.store_id}#${reading.sku_id}`;
      const quantity = reading.quantity;
      const previous = lastRelayed.get(key);
      const first = previous === undefined;
      const moved = !first && Math.abs(quantity - previous) >= deadband;
      const crossedThreshold = !first && (previous < reorderThreshold) !== (quantity < reorderThreshold);
      if (first || moved || crossedThreshold) {
        lastRelayed.set(key, quantity);
        stats.relayed += 1;
        return true;
      }
      stats.suppressed += 1;
      return false;
    },
    stats() {
      return { ...stats };
    },
  };
}

module.exports = { createEdgeFilter };
