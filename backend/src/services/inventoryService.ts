import { InventoryBalance } from '../models/inventoryBalance.js';
import { InventoryMovement } from '../models/inventoryMovement.js';
import { InventoryTransfer } from '../models/inventoryTransfer.js';
import { AuditLog } from '../models/auditLog.js';
import { Product } from '../models/product.js';
import { StockLocation } from '../models/stockLocation.js';
import { Warehouse } from '../models/warehouse.js';

export class InventoryError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export const available = (balance: { quantityOnHand: number; quantityReserved: number }) => balance.quantityOnHand - balance.quantityReserved;

export async function ensureDefaultWarehouse() {
  await Promise.all([Warehouse.init(), StockLocation.init(), InventoryBalance.init(), InventoryTransfer.init()]);
  let warehouse = await Warehouse.findOne({ isDefault: true, status: 'ACTIVE' });
  if (!warehouse) {
    try {
      warehouse = await Warehouse.create({ name: 'Main Warehouse', code: 'MAIN', description: 'Default online-order fulfillment warehouse', isDefault: true });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      warehouse = await Warehouse.findOne({ isDefault: true, status: 'ACTIVE' });
    }
  }
  if (!warehouse) throw new InventoryError('DEFAULT_WAREHOUSE_UNAVAILABLE', 'Default warehouse is unavailable.');
  let location = await StockLocation.findOne({ warehouse: warehouse._id, code: 'PRIMARY' });
  if (!location) {
    try {
      location = await StockLocation.create({ warehouse: warehouse._id, name: 'Primary', code: 'PRIMARY', description: 'Default online-order stock location' });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      location = await StockLocation.findOne({ warehouse: warehouse._id, code: 'PRIMARY' });
    }
  }
  if (!location) throw new InventoryError('DEFAULT_LOCATION_UNAVAILABLE', 'Default stock location is unavailable.');
  return { warehouse, location };
}
export async function ensureBalance(productId: string, warehouseId?: string, locationId?: string) {
  const defaults = await ensureDefaultWarehouse();
  const warehouse = warehouseId || String(defaults.warehouse._id),
    location = locationId || String(defaults.location._id);
  let balance = await InventoryBalance.findOne({ product: productId, warehouse, location });
  if (!balance) {
    const product = await Product.findById(productId).lean();
    if (!product) throw new InventoryError('PRODUCT_NOT_FOUND', 'Product not found.');
    try {
      balance = await InventoryBalance.create({
        product: productId,
        warehouse,
        location,
        quantityOnHand: String(warehouse) === String(defaults.warehouse._id) && String(location) === String(defaults.location._id) ? product.stock || 0 : 0,
        quantityReserved: 0,
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      balance = await InventoryBalance.findOne({ product: productId, warehouse, location });
    }
  }
  if (!balance) throw new InventoryError('BALANCE_UNAVAILABLE', 'Inventory balance is unavailable.');
  return balance;
}
export async function adjustStock(input: {
  productId: string;
  quantityDelta: number;
  reason: string;
  actor?: string | undefined;
  requestId?: string | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  warehouseId?: string | undefined;
  locationId?: string | undefined;
  type?: 'INITIAL' | 'RESTOCK' | 'ORDER' | 'CANCELLATION' | 'RETURN' | 'ADJUSTMENT' | undefined;
}) {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0)
    throw new InventoryError('INVALID_ADJUSTMENT', 'Stock adjustment must be a non-zero integer.');
  const balance = await ensureBalance(input.productId, input.warehouseId, input.locationId);
  const filter: any = { _id: balance._id };
  if (input.quantityDelta < 0) filter.$expr = { $gte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, Math.abs(input.quantityDelta)] };
  const updated = await InventoryBalance.findOneAndUpdate(filter, { $inc: { quantityOnHand: input.quantityDelta } }, { new: true });
  if (!updated) throw new InventoryError('INSUFFICIENT_STOCK', 'Insufficient stock.');
  const product = await Product.findOneAndUpdate(
    { _id: input.productId, ...(input.quantityDelta < 0 ? { stock: { $gte: Math.abs(input.quantityDelta) } } : {}) },
    { $inc: { stock: input.quantityDelta } },
    { new: true }
  );
  if (!product) {
    await InventoryBalance.updateOne({ _id: updated._id, quantityOnHand: updated.quantityOnHand }, { $inc: { quantityOnHand: -input.quantityDelta } });
    throw new InventoryError('PRODUCT_STOCK_MIRROR_FAILED', 'Inventory update could not be completed.');
  }
  try {
    await InventoryMovement.create({
      product: product._id,
      warehouse: updated.warehouse,
      location: updated.location,
      type: input.type || 'ADJUSTMENT',
      quantityDelta: input.quantityDelta,
      previousStock: updated.quantityOnHand - input.quantityDelta,
      newStock: updated.quantityOnHand,
      reason: input.reason,
      actor: input.actor,
      requestId: input.requestId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
  } catch (error) {
    await InventoryBalance.updateOne({ _id: updated._id, quantityOnHand: updated.quantityOnHand }, { $inc: { quantityOnHand: -input.quantityDelta } });
    await Product.updateOne({ _id: product._id, stock: product.stock }, { $inc: { stock: -input.quantityDelta } });
    throw error;
  }
  return product;
}
export async function adjustStockWithAudit(
  input: {
    productId: string;
    quantityDelta: number;
    reason: string;
    actor: string;
    requestId?: string | undefined;
    warehouseId?: string | undefined;
    locationId?: string | undefined;
  },
  auditWriter: (entry: Record<string, unknown>) => Promise<unknown> = entry => AuditLog.create(entry)
) {
  const product = await adjustStock({ ...input, type: 'ADJUSTMENT' });
  try {
    await auditWriter({
      actor: input.actor,
      action: 'INVENTORY_ADJUSTED',
      resourceType: 'Product',
      resourceId: String(product._id),
      requestId: input.requestId,
      metadata: { quantityDelta: input.quantityDelta, reason: input.reason, warehouseId: input.warehouseId, locationId: input.locationId },
    });
  } catch {
    await adjustStock({ ...input, quantityDelta: -input.quantityDelta, reason: 'Inventory adjustment audit compensation', type: 'ADJUSTMENT' });
    throw new InventoryError('ADJUSTMENT_AUDIT_FAILED', 'Inventory adjustment could not be completed.');
  }
  return product;
}
export async function transferStock(input: {
  productId: string;
  sourceWarehouseId: string;
  sourceLocationId: string;
  destinationWarehouseId: string;
  destinationLocationId: string;
  quantity: number;
  reason: string;
  actor: string;
  requestId?: string | undefined;
  idempotencyKey: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new InventoryError('INVALID_TRANSFER', 'Transfer quantity must be a positive integer.');
  if (input.sourceLocationId === input.destinationLocationId) throw new InventoryError('SELF_TRANSFER', 'Source and destination locations must differ.');
  const replay = await InventoryTransfer.findOne({ idempotencyKey: input.idempotencyKey }).lean();
  if (replay) return replay;
  const [sourceLocation, destinationLocation] = await Promise.all([
    StockLocation.findOne({ _id: input.sourceLocationId, warehouse: input.sourceWarehouseId, status: 'ACTIVE' }),
    StockLocation.findOne({ _id: input.destinationLocationId, warehouse: input.destinationWarehouseId, status: 'ACTIVE' }),
  ]);
  if (!sourceLocation || !destinationLocation) throw new InventoryError('LOCATION_INVALID', 'Source or destination location is unavailable.');
  const [source, destination] = await Promise.all([
    ensureBalance(input.productId, input.sourceWarehouseId, input.sourceLocationId),
    ensureBalance(input.productId, input.destinationWarehouseId, input.destinationLocationId),
  ]);
  const reduced = await InventoryBalance.findOneAndUpdate(
    { _id: source._id, $expr: { $gte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, input.quantity] } },
    { $inc: { quantityOnHand: -input.quantity } },
    { new: true }
  );
  if (!reduced) throw new InventoryError('INSUFFICIENT_STOCK', 'Insufficient stock.');
  let increased: any;
  try {
    increased = await InventoryBalance.findByIdAndUpdate(destination._id, { $inc: { quantityOnHand: input.quantity } }, { new: true });
    const transfer = await InventoryTransfer.create({
      product: input.productId,
      sourceWarehouse: input.sourceWarehouseId,
      sourceLocation: input.sourceLocationId,
      destinationWarehouse: input.destinationWarehouseId,
      destinationLocation: input.destinationLocationId,
      quantity: input.quantity,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
      requestId: input.requestId,
    });
    await InventoryMovement.create([
      {
        product: input.productId,
        warehouse: source.warehouse,
        location: source.location,
        type: 'TRANSFER_OUT',
        quantityDelta: -input.quantity,
        previousStock: reduced.quantityOnHand + input.quantity,
        newStock: reduced.quantityOnHand,
        reason: input.reason,
        actor: input.actor,
        requestId: input.requestId,
        referenceType: 'InventoryTransfer',
        referenceId: String(transfer._id),
      },
      {
        product: input.productId,
        warehouse: destination.warehouse,
        location: destination.location,
        type: 'TRANSFER_IN',
        quantityDelta: input.quantity,
        previousStock: increased.quantityOnHand - input.quantity,
        newStock: increased.quantityOnHand,
        reason: input.reason,
        actor: input.actor,
        requestId: input.requestId,
        referenceType: 'InventoryTransfer',
        referenceId: String(transfer._id),
      },
    ]);
    return transfer.toObject();
  } catch (error: any) {
    if (increased)
      await InventoryBalance.updateOne({ _id: destination._id, quantityOnHand: increased.quantityOnHand }, { $inc: { quantityOnHand: -input.quantity } });
    await InventoryBalance.updateOne({ _id: reduced._id, quantityOnHand: reduced.quantityOnHand }, { $inc: { quantityOnHand: input.quantity } });
    if (error?.code === 11000) {
      const duplicate = await InventoryTransfer.findOne({ idempotencyKey: input.idempotencyKey }).lean();
      if (duplicate) return { ...duplicate, __replayed: true };
    }
    throw error;
  }
}
