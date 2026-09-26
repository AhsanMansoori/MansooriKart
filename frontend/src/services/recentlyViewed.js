/**
 * The shopper's recent browsing history, kept in the browser.
 *
 * This is the whole of the "recently viewed" feature: a short list of product ids the
 * shopper opened, stored locally and never sent anywhere. It replaces the vector-database
 * recommendation service that used to power these rails, and deliberately involves no
 * server-side profile, no embedding and no similarity model.
 */
const KEY = 'visitedProducts';
const MAX_ENTRIES = 12;

const readRaw = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Unable to read recently viewed products', error);
    return [];
  }
};

/** Most recently viewed first, newest visit wins, malformed entries dropped. */
export function readVisitedProducts() {
  const seen = new Set();
  const ordered = [];
  const entries = readRaw();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const id = entry && entry.id ? String(entry.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push({ ...entry, id });
  }
  return ordered;
}

export function recordVisitedProduct(product) {
  const id = product && (product.id || product._id) ? String(product.id || product._id) : '';
  if (!id) return;
  try {
    const next = [
      ...readRaw().filter(entry => entry && String(entry.id) !== id),
      { id, name: product.name, image: product.image, price: product.price, visitedAt: Date.now() },
    ].slice(-MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Unable to track visited product', error);
  }
}

/** Used when a product turns out to be gone, so a stale id cannot linger in the rail. */
export function forgetVisitedProduct(id) {
  if (!id) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(readRaw().filter(entry => entry && String(entry.id) !== String(id))));
  } catch (error) {
    console.warn('Unable to prune recently viewed products', error);
  }
}
