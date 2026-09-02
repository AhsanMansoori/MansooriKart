import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { Review } from './models/review.js';

async function start(): Promise<void> {
  const config = getConfig();
  await mongoose.connect(config.mongoUri);
  await Review.init();
  createApp(config).listen(config.port, '0.0.0.0', () => console.log(`MansooriKart v1 server ready on port ${config.port}.`));
}

start().catch(error => {
  console.error('Backend startup failed', error);
  process.exitCode = 1;
});
