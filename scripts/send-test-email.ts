// Sends one real email through MailerSend to check configuration.
// Usage: npm run email:test -- someone@example.com   (reads MAILERSEND_API_TOKEN and MAIL_FROM from .env.local)
import { sendEmail } from '../lib/email';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

const to = process.argv[2];
if (!to) {
  console.error('Usage: npm run email:test -- <recipient address>');
  process.exit(2);
}

const { id } = await sendEmail({
  to,
  subject: 'SparkKindly test email',
  text: 'If you can read this, MailerSend is configured.',
});
console.log(`Sent. MailerSend message id: ${id || '(none returned)'}`);
