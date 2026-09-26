import PDFDocument from 'pdfkit';
import type { InvoiceModel } from './invoice.js';

/**
 * Renders the immutable invoice projection to a PDF buffer.
 *
 * pdfkit ships the standard-14 AFM fonts, so no font assets, headless browser or native module is
 * required. Input is the order snapshot only — never live Product data.
 */

const PAGE_MARGIN = 50;
const COLUMNS = { name: 50, sku: 250, qty: 340, unit: 390, line: 470 } as const;

const money = (currency: string, value: number) => `${currency} ${value.toFixed(2)}`;

function addressLines(address: Record<string, unknown> | null): string[] {
  if (!address) return [];
  const parts = ['fullName', 'addressLine1', 'addressLine2']
    .map(key => address[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const locality = ['city', 'stateProvince', 'postalCode', 'country']
    .map(key => address[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(', ');
  if (locality) parts.push(locality);
  const phone = address['phone'];
  if (typeof phone === 'string' && phone) parts.push(`Phone: ${phone}`);
  return parts;
}

export function renderInvoicePdf(invoice: InvoiceModel): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    // `compress: false` keeps the content stream inspectable, so invoice text can be verified by
    // tests and support staff without a PDF parser. Invoices are a few kilobytes either way.
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text(invoice.storeName, { align: 'left' });
    doc.font('Helvetica').fontSize(10).text('Tax Invoice / Receipt');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text(`Invoice: ${invoice.invoiceNumber}`);
    doc.font('Helvetica').fontSize(10).text(`Order: ${invoice.orderNumber}`);
    doc.text(`Order date: ${new Date(invoice.orderDate).toISOString().slice(0, 10)}`);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text('Billed to');
    doc.font('Helvetica').fontSize(10);
    if (invoice.customer.name) doc.text(invoice.customer.name);
    if (invoice.customer.email) doc.text(invoice.customer.email);
    for (const line of addressLines(invoice.shippingAddress)) doc.text(line);
    doc.moveDown(0.8);

    const headerY = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Item', COLUMNS.name, headerY);
    doc.text('SKU', COLUMNS.sku, headerY);
    doc.text('Qty', COLUMNS.qty, headerY);
    doc.text('Unit', COLUMNS.unit, headerY);
    doc.text('Amount', COLUMNS.line, headerY);
    doc
      .moveTo(PAGE_MARGIN, doc.y + 2)
      .lineTo(545, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(9);
    for (const item of invoice.items) {
      const rowY = doc.y;
      doc.text(item.name, COLUMNS.name, rowY, { width: 190 });
      doc.text(item.sku ?? '-', COLUMNS.sku, rowY, { width: 80 });
      doc.text(String(item.quantity), COLUMNS.qty, rowY, { width: 40 });
      doc.text(item.unitPrice.toFixed(2), COLUMNS.unit, rowY, { width: 70 });
      doc.text(item.lineSubtotal.toFixed(2), COLUMNS.line, rowY, { width: 75 });
      doc.moveDown(0.4);
    }

    doc
      .moveTo(PAGE_MARGIN, doc.y + 2)
      .lineTo(545, doc.y + 2)
      .stroke();
    doc.moveDown(0.6);

    const totals: [string, number][] = [
      ['Subtotal', invoice.subtotal],
      ['Discount', invoice.discount],
      ['Shipping', invoice.shipping],
      ['Tax', invoice.tax],
    ];
    doc.font('Helvetica').fontSize(10);
    for (const [label, value] of totals) {
      const rowY = doc.y;
      doc.text(label, COLUMNS.unit, rowY);
      doc.text(money(invoice.currency, value), COLUMNS.line, rowY);
      doc.moveDown(0.3);
    }
    const totalY = doc.y;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Grand total', COLUMNS.unit, totalY);
    doc.text(money(invoice.currency, invoice.total), COLUMNS.line, totalY);
    doc.moveDown(1);

    doc.font('Helvetica').fontSize(10).text(`Payment method: ${invoice.paymentMethod}`, PAGE_MARGIN);
    doc.text(`Payment status: ${invoice.paymentStatus}`);
    doc.text(`Currency: ${invoice.currency}`);

    doc.end();
  });
}
