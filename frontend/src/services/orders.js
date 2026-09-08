/**
 * The signed-in shopper's own orders.
 *
 * Every route here is authenticated and scoped to the caller by the API: an order is only ever
 * readable by the customer who placed it. There is no anonymous lookup — the previous
 * order-number-plus-email form let anyone holding those two strings read someone else's order.
 */
import { apiClient, unwrap, withRetry } from './apiClient';

/** Human-readable labels for the order lifecycle the API actually emits. */
export const ORDER_STATUS_LABELS = {
  PENDING: 'Order placed',
  CONFIRMED: 'Order confirmed',
  PROCESSING: 'Preparing your order',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURN_REQUESTED: 'Return requested',
  RETURN_APPROVED: 'Return approved',
  RETURN_REJECTED: 'Return rejected',
  RETURNED: 'Returned',
};

/** The happy path a Cash-on-Delivery order walks, used to draw the progress steps. */
export const ORDER_PROGRESS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

export const orderStatusLabel = status => ORDER_STATUS_LABELS[status] || status || 'Unknown';

export async function fetchMyOrders({ limit = 20 } = {}) {
  const response = await withRetry(() => apiClient.get('orders', { params: { limit } }));
  const rows = unwrap(response);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchOrderTracking(orderId) {
  const response = await withRetry(() => apiClient.get(`orders/${encodeURIComponent(orderId)}/tracking`));
  return unwrap(response);
}
