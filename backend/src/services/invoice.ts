/**
 * Immutable invoice projection.
 *
 * Every field is read from the persisted order snapshot captured at checkout. Product documents are
 * never consulted here, so editing a product after purchase can never alter a historical invoice.
 */

export const STORE_NAME = 'MansooriKart';

export interface InvoiceItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
}

export interface InvoiceCustomer {
  id: string;
  name: string | null;
  email: string | null;
}

export interface InvoiceModel {
  invoiceNumber: string;
  storeName: string;
  orderNumber: string;
  orderDate: Date;
  customer: InvoiceCustomer;
  shippingAddress: Record<string, unknown> | null;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
}

/**
 * Server-generated, immutable and collision-safe: it is derived from the unique `orderNumber`, so no
 * separate Invoice collection is required. Legacy orders created before the field existed fall back
 * to the same deterministic derivation. Never client-controlled.
 */
export function invoiceNumberFor(order: { invoiceNumber?: string | null; orderNumber: string }): string {
  return order.invoiceNumber || `INV-${order.orderNumber}`;
}

/** Only operational identity is exposed — never password hashes, tokens or the internal user object. */
function safeCustomer(customer: unknown): InvoiceCustomer {
  if (customer && typeof customer === 'object') {
    const record = customer as Record<string, unknown>;
    if ('name' in record || 'email' in record)
      return {
        id: String(record['_id'] ?? ''),
        name: typeof record['name'] === 'string' ? record['name'] : null,
        email: typeof record['email'] === 'string' ? record['email'] : null,
      };
  }
  return { id: String(customer ?? ''), name: null, email: null };
}

export function buildInvoice(order: Record<string, any>): InvoiceModel {
  const items: InvoiceItem[] = (order['items'] ?? []).map((item: Record<string, any>) => ({
    name: String(item['name'] ?? ''),
    sku: typeof item['sku'] === 'string' ? item['sku'] : null,
    quantity: Number(item['quantity'] ?? 0),
    unitPrice: Number(item['unitPrice'] ?? 0),
    lineSubtotal: Number(item['lineSubtotal'] ?? 0),
  }));
  return {
    invoiceNumber: invoiceNumberFor(order as { orderNumber: string }),
    storeName: STORE_NAME,
    orderNumber: String(order['orderNumber']),
    orderDate: order['createdAt'],
    customer: safeCustomer(order['customer']),
    shippingAddress: (order['shippingAddress'] ?? null) as Record<string, unknown> | null,
    items,
    subtotal: Number(order['subtotal'] ?? 0),
    discount: Number(order['discount'] ?? 0),
    shipping: Number(order['shipping'] ?? 0),
    tax: Number(order['tax'] ?? 0),
    total: Number(order['total'] ?? 0),
    currency: String(order['currency'] ?? 'PKR'),
    paymentMethod: String(order['paymentMethod'] ?? ''),
    paymentStatus: String(order['paymentStatus'] ?? ''),
  };
}
