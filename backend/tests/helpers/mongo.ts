import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Real transactions with a single local replica-set member; never download in CI runs. */
export const MongoMemoryServer = {
  create: (options: Parameters<typeof MongoMemoryReplSet.create>[0] = {}) =>
    MongoMemoryReplSet.create({ ...options, replSet: { ...options.replSet, count: 1 } }),
};
