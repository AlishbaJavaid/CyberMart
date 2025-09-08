import { test, expect } from '@playwright/test';
import fs from 'fs';

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

  // … continue OTP etc …

  // ✅ Save into sellers.json
  const sellersFile = 'sellers.json';
  const sellers = fs.existsSync(sellersFile)
    ? JSON.parse(fs.readFileSync(sellersFile, 'utf8'))
    : {};

  sellers.lastSignup = { email, password };

  fs.writeFileSync(sellersFile, JSON.stringify(sellers, null, 2));
  console.log('💾 Updated sellers.json with lastSignup');
});
