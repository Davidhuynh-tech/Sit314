/**
 * Stage admission control.
 * POS events are high priority and are kept up to the hard limit.
 * Shelf events are low priority and are shed once depth reaches the soft limit.
 */
function createAdmissionControl({ softLimit = 500, hardLimit = 2000 } = {}) {
  const stats = { posAccepted: 0, posRejected: 0, shelfAccepted: 0, shelfRejected: 0 };

  return {
    admit(depth, priority) {
      const high = priority === "pos";
      if (depth >= hardLimit || (!high && depth >= softLimit)) {
        if (high) stats.posRejected += 1;
        else stats.shelfRejected += 1;
        return false;
      }
      if (high) stats.posAccepted += 1;
      else stats.shelfAccepted += 1;
      return true;
    },
    stats() {
      return { ...stats, softLimit, hardLimit };
    },
  };
}

module.exports = { createAdmissionControl };
