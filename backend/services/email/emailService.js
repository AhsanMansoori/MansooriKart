const { log } = require('../../utils/logger');

async function sendPasswordReset({ email, resetUrl }) {
  if (process.env.NODE_ENV === 'development') {
    log('info', 'development_password_reset_url', { email, resetUrl });
  }
  // A production provider adapter will be selected in a later phase.
}

module.exports = { sendPasswordReset };
