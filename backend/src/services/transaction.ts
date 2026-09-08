import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

mongoose.set('transactionAsyncLocalStorage', true);
const context = new AsyncLocalStorage<{ afterCommit: Array<() => Promise<unknown>> }>();
const initialized = new WeakMap<object, Promise<void>>();

export function rethrowTransient(error: any): void {
  if (error?.hasErrorLabel?.('TransientTransactionError') || error?.hasErrorLabel?.('UnknownTransactionCommitResult') || error?.code === 11000) throw error;
}

/** Prepare indexes outside transactions; refuse deployments that cannot commit atomically. */
export async function prepareTransactions(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB must be connected before starting a transaction.');
  let ready = initialized.get(db);
  if (!ready) {
    ready = (async () => {
      const hello = await db.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MansooriKart requires a MongoDB replica set or sharded cluster.');
      for (const model of Object.values(mongoose.models)) {
        await model.createCollection();
        await model.createIndexes();
      }
    })();
    initialized.set(db, ready);
    ready.catch(() => initialized.delete(db));
  }
  await ready;
}

/** Nested service calls share one session. Never run parallel database writes in this callback. */
export async function atomic<T>(work: () => Promise<T>): Promise<T> {
  if (context.getStore()) return work();
  await prepareTransactions();
  let callbacks: Array<() => Promise<unknown>> = [];
  const run = () =>
    mongoose.connection.transaction(async () => {
      const scope = { afterCommit: [] as Array<() => Promise<unknown>> };
      const value = await context.run(scope, work);
      callbacks = scope.afterCommit;
      return value;
    });
  let result: T;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await run();
      break;
    } catch (error: any) {
      // Concurrent creation of a unique balance/idempotency record retries the entire unit.
      if (error?.code !== 11000 || attempt >= 2) throw error;
    }
  }
  for (const callback of callbacks) {
    // Delivery is best effort until the durable email outbox is implemented.
    await callback().catch(() => console.error('Post-commit notification failed.'));
  }
  return result;
}

export function afterCommit(work: () => Promise<unknown>): void {
  const scope = context.getStore();
  if (!scope) throw new Error('afterCommit requires an active transaction.');
  scope.afterCommit.push(work);
}
