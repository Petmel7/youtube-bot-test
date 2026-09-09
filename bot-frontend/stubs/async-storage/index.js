const getStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

const toStringValue = (value) => (typeof value === "string" ? value : String(value));

const AsyncStorage = {
  async getItem(key) {
    const storage = getStorage();
    return storage ? storage.getItem(key) : null;
  },

  async setItem(key, value) {
    const storage = getStorage();
    if (storage) {
      storage.setItem(key, toStringValue(value));
    }
  },

  async removeItem(key) {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(key);
    }
  },

  async mergeItem(key, value) {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    const existing = storage.getItem(key);
    if (!existing) {
      storage.setItem(key, toStringValue(value));
      return;
    }

    try {
      const merged = {
        ...JSON.parse(existing),
        ...JSON.parse(toStringValue(value))
      };
      storage.setItem(key, JSON.stringify(merged));
    } catch {
      storage.setItem(key, toStringValue(value));
    }
  },

  async clear() {
    const storage = getStorage();
    if (storage) {
      storage.clear();
    }
  },

  async getAllKeys() {
    const storage = getStorage();
    if (!storage) {
      return [];
    }

    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
  },

  async multiGet(keys) {
    const storage = getStorage();
    return keys.map((key) => [key, storage ? storage.getItem(key) : null]);
  },

  async multiSet(entries) {
    const storage = getStorage();
    if (storage) {
      entries.forEach(([key, value]) => storage.setItem(key, toStringValue(value)));
    }
  },

  async multiRemove(keys) {
    const storage = getStorage();
    if (storage) {
      keys.forEach((key) => storage.removeItem(key));
    }
  }
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
