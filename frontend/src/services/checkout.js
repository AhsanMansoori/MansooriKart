/**
 * Placing a Cash-on-Delivery order against the v1 API.
 *
 * The v1 checkout is a signed-in flow and it reads the cart from the server, so a browser cart
 * has to be staged before it can be ordered. The sequence is therefore:
 *
 *   1. idempotently synchronize selected lines without deleting another device's cart,
 *   2. save the delivery address,
 *   3. preview server-derived PKR charges,
 *   4. confirm that exact quote with a single Idempotency-Key.
 *
 * The key is generated once per attempt and reused across retries, so a retried request can
 * never create a second order. Cash on Delivery remains the only payment method: nothing here
 * collects, sends or stores card details.
 */
import { apiClient, unwrap, withRetry } from './apiClient';

export const PAYMENT_METHOD = 'CASH_ON_DELIVERY';

const newIdempotencyKey = () =>
  window.crypto?.randomUUID?.() || `mk-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

/** The v1 cart accepts 24-character hex product ids only, so a malformed line is dropped early. */
const toCartItems = items =>
  (Array.isArray(items) ? items : [])
    .map(item => ({ productId: String(item?._id || item?.id || ''), quantity: Math.max(1, Number(item?.quantity) || 1) }))
    .filter(item => /^[a-f\d]{24}$/i.test(item.productId));

const trimmed = value => (typeof value === 'string' ? value.trim() : '');

/**
 * The delivery address in the shape the v1 address endpoint accepts.
 *
 * That body is strict, so the checkout form's `email` and `paymentMethod` must not be forwarded:
 * they belong to the order, not the address. Blank optionals are omitted rather than sent empty.
 */
export function toAddressPayload(form = {}) {
  const payload = {
    fullName: trimmed(form.fullName),
    phone: trimmed(form.phone),
    addressLine1: trimmed(form.addressLine1),
    city: trimmed(form.city),
    country: trimmed(form.country),
  };
  ['addressLine2', 'stateProvince', 'postalCode'].forEach(key => {
    const value = trimmed(form[key]);
    if (value) payload[key] = value;
  });
  return payload;
}

export async function prepareCodOrder({ items, address }) {
  const cartItems = toCartItems(items);
  if (!cartItems.length) throw new Error('Your selected items are no longer available.');

  const syncKey = newIdempotencyKey();
  await withRetry(() => apiClient.put('cart/sync', { items: cartItems }, { headers: { 'Idempotency-Key': syncKey } }));

  const saved = unwrap(await apiClient.post('me/addresses', address));
  if (!saved?.id) throw new Error('We could not save your delivery address.');

  const body = { addressId: saved.id, paymentMethod: PAYMENT_METHOD, items: cartItems };
  const quote = unwrap(await withRetry(() => apiClient.post('checkout/preview', body)));
  return { body, quote, idempotencyKey: newIdempotencyKey() };
}

export async function confirmCodOrder(prepared) {
  const order = unwrap(
    await withRetry(() =>
      apiClient.post('checkout', { ...prepared.body, quoteHash: prepared.quote.quoteHash }, { headers: { 'Idempotency-Key': prepared.idempotencyKey } })
    )
  );
  return order;
}

/** Compatibility helper for callers that intentionally confirm in one operation. */
export async function placeCodOrder(input) {
  return confirmCodOrder(await prepareCodOrder(input));
}
