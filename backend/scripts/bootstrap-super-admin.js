require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { validateEnvironment } = require('../config/env');
const User = require('../models/user');

async function run() {
  validateEnvironment();
  const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME = 'MansooriKart Super Admin' } = process.env;
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD)
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set for this explicit bootstrap command.');
  if (SUPER_ADMIN_PASSWORD.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  await mongoose.connect(process.env.MONGO_URI);
  const existing = await User.findOne({ email: SUPER_ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    existing.role = 'SUPER_ADMIN';
    await existing.save();
    console.log('Existing user promoted to SUPER_ADMIN.');
  } else {
    await User.create({
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL.toLowerCase(),
      password: await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12),
      role: 'SUPER_ADMIN',
    });
    console.log('SUPER_ADMIN created.');
  }
  await mongoose.disconnect();
}
run().catch(async error => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
