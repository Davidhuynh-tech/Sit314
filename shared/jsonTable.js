const fs = require("fs");
const path = require("path");

function createJsonTable(filename) {
  const dir = path.join(__dirname, "..", "data");
  const file = path.join(dir, filename);

  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  function save(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  return {
    file,
    async get(key) {
      return load()[key];
    },
    async put(key, value) {
      const data = load();
      data[key] = value;
      save(data);
      return value;
    },
    async update(key, mutator) {
      const data = load();
      const next = mutator(data[key]);
      data[key] = next;
      save(data);
      return next;
    },
    async values() {
      return Object.values(load());
    },
  };
}

module.exports = { createJsonTable };
