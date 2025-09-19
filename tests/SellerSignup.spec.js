import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// --- Random generators ---
function randomEmail() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomPart = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `alishba+${randomPart}@cybermart.com`;
}

// … your random generators (randomEmail, etc.)

test('Business account signup flow', async ({ page }) => {
  const email = randomEmail();
  const password = 'Alishba@123';

  await page.goto('https://qav2.cybermart.com/sign-up');
  await page.getByTestId('emailOrPhone').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('confirmPassword').fill(password);

  console.log(`📝 New signup email: ${email}`);

  // Wait + solve reCAPTCHA manually
  console.log('⚠️ Please solve reCAPTCHA manually...');
  await page.waitForFunction(() => {
    const el = document.querySelector('textarea[name="g-recaptcha-response"]');
    return el && el.value.length > 0;
  }, { timeout: 180000 });

  await page.getByTestId('signup-submit').click();

  // --- OTP verification step ---
  await page.getByRole('textbox', { name: 'Enter OTP *' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('textbox', { name: 'Enter OTP *' }).fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();

   // --- Wait until landing on welcome page ---
  await page.waitForURL('https://qav2.cybermart.com/welcome', { timeout: 30000 });
  console.log('🎉 Landed on welcome page!');

  // ✅ Save into sellers.json
  const sellersFile = path.resolve(__dirname, 'sellers.json');
  const sellers = fs.existsSync(sellersFile)
    ? JSON.parse(fs.readFileSync(sellersFile, 'utf8'))
    : {};

  sellers.lastSignup = { email, password };

  fs.writeFileSync(sellersFile, JSON.stringify(sellers, null, 2));
  console.log('💾 Updated sellers.json with lastSignup');
});
