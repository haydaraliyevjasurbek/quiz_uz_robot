const counters = new Map();

function inc(name, by = 1) {
  counters.set(name, (counters.get(name) || 0) + by);
}

function snapshot() {
  const obj = {};
  for (const [k, v] of counters.entries()) obj[k] = v;
  return obj;
}

module.exports = {
  inc,
  snapshot
};
