import { prepareTransactions } from './services/transaction.js';
import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { Review } from './models/review.js';
import { User } from './models/user.js';

/**
 * Process entry point.
 *
 * Configuration is read and validated before anything connects: an invalid production
 * environment must fail at startup with a message naming the variable, not surface later as
 * a request-time error (§13).
 *
 * `Model.init()` is awaited for every model whose uniqueness is a correctness invariant
 * rather than a convenience. Mongoose builds indexes in the background otherwise, which
 * leaves a window in which two writes can both succeed; `User` covers email uniqueness and
 * the partial-unique Google subject index, `Review` covers the one-review-per-customer rule
 * (§31).
 */
async function start(): Promise<void> {
  const config = getConfig();
  await mongoose.connect(config.mongoUri);
  await Promise.all([User.init(), Review.init()]);
  await prepareTransactions();
  createApp(config).listen(config.port, '0.0.0.0', () => console.log(`MansooriKart v1 server ready on port ${config.port}.`));
}

start().catch(error => {
  console.error('Backend startup failed', error);
  process.exitCode = 1;
});
