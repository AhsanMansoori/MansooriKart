/**
 * A pointer to the shopper's most recent order, kept in the browser.
 *
 * Order tracking is an authenticated, id-addressed API call now, so what is useful to remember
 * is the order's id — not the email address the old anonymous lookup needed. The obsolete
 * `fusionLastOrder` entry is cleared on write so a stale email is not left sitting in storage.
 */
const KEY = 'mansoorikart_last_order';
const LEGACY_KEY = 'fusionLastOrder';

export function rememberLastOrder(order) {
  const orderId = order && (order._id || order.id) ? String(order._id || order.id) : '';
  if (!orderId) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ orderId, orderNumber: order.orderNumber }));
    localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    console.warn('Unable to persist last order reference', error);
  }
}

export function readLastOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return parsed && parsed.orderId ? parsed : null;
  } catch (error) {
    return null;
  }
}
