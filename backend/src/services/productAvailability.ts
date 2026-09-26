import { InventoryBalance } from '../models/inventoryBalance.js';
import { StockLocation } from '../models/stockLocation.js';
import { Warehouse } from '../models/warehouse.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';
import { preferredSupplierSource } from './dropshipService.js';

/** Bulk read only: online stock is MAIN/PRIMARY, supplier quantities are never invented. */
export async function withAvailability(products: any[]): Promise<any[]> {
  if (!products.length) return [];
  const warehouse = await Warehouse.findOne({ isDefault: true, status: 'ACTIVE' }).select('_id').lean();
  const location = warehouse ? await StockLocation.findOne({ warehouse: warehouse._id, code: 'PRIMARY', status: 'ACTIVE' }).select('_id').lean() : null;
  const ids = products.map(product => product._id);
  const balances = await InventoryBalance.find({ product: { $in: ids } }).lean();
  const sources = await SupplierCatalogItem.find({ product: { $in: ids }, isActive: true })
    .select('product supplierAvailability createdAt')
    .lean();
  return products.map(product => {
    let availableStock: number | null;
    let status: string;
    let canPurchase: boolean;
    if (product.fulfillmentType === 'DROPSHIP') {
      const candidates = sources.filter((source: any) => String(source.product) === String(product._id));
      const source = candidates.length ? preferredSupplierSource(candidates) : undefined;
      status = source ? String(source.supplierAvailability ?? 'UNKNOWN') : 'UNAVAILABLE';
      canPurchase = Boolean(source) && status !== 'OUT_OF_STOCK';
      availableStock = canPurchase ? null : 0;
    } else {
      const existing = balances.filter((balance: any) => String(balance.product) === String(product._id));
      const balance = existing.find((entry: any) => String(entry.warehouse) === String(warehouse?._id) && String(entry.location) === String(location?._id));
      availableStock = balance ? Math.max(0, balance.quantityOnHand - balance.quantityReserved) : existing.length ? 0 : Math.max(0, product.stock ?? 0);
      canPurchase = availableStock > 0;
      status = canPurchase ? 'IN_STOCK' : 'OUT_OF_STOCK';
    }
    if (product.status && product.status !== 'ACTIVE') canPurchase = false;
    return { ...product, publicAvailability: { status, canPurchase, availableStock } };
  });
}
