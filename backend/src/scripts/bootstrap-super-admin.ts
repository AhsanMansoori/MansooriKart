import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { getConfig } from '../config/env.js';
import { User } from '../models/user.js';

/**
 * Explicit Super Admin bootstrap.
 *
 * The only way a `SUPER_ADMIN` role is ever written. It is a deliberate operator action run
 * from a shell with credentials supplied for that single invocation — never an HTTP route,
 * never a seed that runs on deploy, and never something Google sign-in can reach: Google
 * resolves to `CUSTOMER` accounts only (see `services/googleAuthService.ts`).
 *
 * The two credentials live in the process environment for the length of the command and are
 * neither logged nor persisted anywhere but the password hash (§33). They are absent from
 * `config/env.ts` on purpose: they are inputs to this script, not application configuration,
 * so the running server has no reason to read them.
 *
 * Usage:  SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… npm run bootstrap:super-admin
 */
async function run(): Promise<void> {
  const config = getConfig();
  const email = (process.env['SUPER_ADMIN_EMAIL'] ?? '').trim().toLowerCase();
  const passwordInput = process.env['SUPER_ADMIN_PASSWORD'] ?? '';
  const name = (process.env['SUPER_ADMIN_NAME'] ?? '').trim() || 'MansooriKart Super Admin';

  if (!email || !passwordInput) throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set for this explicit bootstrap command.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('SUPER_ADMIN_EMAIL must be a valid email address.');
  if (passwordInput.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');

  await mongoose.connect(config.mongoUri);
  await User.init();

  const password = await bcrypt.hash(passwordInput, 12);
  const existing = await User.findOne({ email });
  if (existing) {
    // Promotion keeps the account's existing credentials and history; only the role moves.
    existing.role = 'SUPER_ADMIN';
    await existing.save();
    console.log('Existing user promoted to SUPER_ADMIN.');
  } else {
    await User.create({ name, email, password, authProviders: ['LOCAL'], role: 'SUPER_ADMIN', status: 'ACTIVE' });
    console.log('SUPER_ADMIN created.');
  }
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error(error instanceof Error ? error.message : 'Super Admin bootstrap failed.');
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
