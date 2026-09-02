# MansooriKart Inventory Architecture

## Authority and compatibility

**INVENTORY AUTHORITY:** `InventoryBalance`.

**Current compatibility field:** `Product.stock` remains available to existing cart, checkout, legacy-compatible serializers, and regression tests.

**Target authority:** `InventoryBalance.quantityOnHand` and `quantityReserved`, uniquely identified by product, warehouse, and stock location. Available inventory is calculated as `quantityOnHand - quantityReserved`; negative available inventory is rejected. `Product.stock` is a service-maintained compatibility mirror and is never accepted from warehouse-aware inventory requests. Its exact meaning is total `quantityOnHand` across all product balances; transfers conserve that total, while adjustments, checkout, and cancellation update both balance and mirror through `adjustStock`.

`ensureBalance` provides lazy, idempotent backfill. The first inventory operation for a pre-existing product creates a balance in the default warehouse/location using the existing `Product.stock` value. It does not erase or overwrite existing product data. Online checkout fulfils from the deterministic default `MAIN` warehouse and its `PRIMARY` location. Cancellation uses the same adjustment path and restores there; allocation is not yet stored on an individual order snapshot.

## Warehouses, locations, and movements

Warehouses use unique codes and at most one `isDefault` value, enforced by a partial unique database index. A default `MAIN` warehouse and `PRIMARY` location are initialized lazily and idempotently. Locations belong to one warehouse and use a unique `(warehouse, code)` identity. Locations with on-hand inventory cannot be archived.

Inventory movements are immutable evidence. They record the product, warehouse, location, movement type, signed quantity, before/after quantity, safe reference fields, actor, request ID, and timestamp. Corrections are new adjustments; there are no mutation or deletion routes for movements.

## Operations

Adjustments atomically condition available stock before decrementing, update the compatibility mirror, and then write a movement. If movement persistence fails, both balance and mirror are compensated. Transfers atomically condition the source decrement, add the destination quantity, write paired `TRANSFER_OUT`/`TRANSFER_IN` movements, and compensate both sides if later persistence fails. Transfers require an `Idempotency-Key`; its unique persisted transfer record is the durable idempotency authority, so repeated and concurrent replays return the original transfer without moving stock or adding a second success audit.

Adjustment audit persistence is part of the operation: if its audit write fails after the inventory mutation, a compensating immutable adjustment restores the balance and mirror and the caller receives a safe failure. Transfer persistence failures similarly compensate source and destination balances; no completed transfer record or success audit is retained.

Low stock is calculated from total product availability across warehouse balances: a product is out of stock when total available is zero, and low stock when total available is greater than zero and less than or equal to `lowStockThreshold` (default 5).

**LOW STOCK AGGREGATION:** total available quantity across all balances for the product. **LOW STOCK THRESHOLD BOUNDARY:** `0 < available <= lowStockThreshold`. **OUT OF STOCK AGGREGATION:** total available quantity across all balances is `<= 0`.

**CHECKOUT VS TRANSFER CONCURRENCY:** both operations use the same indexed product/warehouse/location balance and an atomic conditional available-quantity decrement; only one can consume the final source unit. **CHECKOUT VS ADJUSTMENT CONCURRENCY:** the same conditional decrement rule prevents dual final-unit deductions.

Checkout and cancellation keep using `adjustStock`, so order deduction and exact-once cancellation restoration now pass through the balance authority while retaining their existing Product stock behavior. Reservations are **deferred**: checkout immediately decrements inventory and there is no reservation lifecycle yet. Product variants and weight are also deferred because current checkout is product-level and introducing independently stocked variants would create a second sellable-stock authority.

Purchasing and returns are not implemented. The movement enum reserves `PURCHASE_RECEIPT`, `PURCHASE_RETURN`, and `RETURN` for later services; no public purchasing endpoints exist.
