import { test, expect } from '@playwright/test';
import fs from 'fs';

test('Seller login flow (with auto-auth)', async ({ page, context }) => {
  test.setTimeout(120000); // allow 2 mins for manual CAPTCHA

  const authFile = 'auth.json';

  if (!fs.existsSync(authFile)) {
    // First-time login
    await page.goto('https://qav2.cybermart.com/');
    await page.getByTestId('login-dashboard').click();
    
    await page.getByTestId('emailOrPhone').fill('alishba+1@cybermart.com');
    await page.getByTestId('password').fill('Alishba@4321');

    console.log('⚠️ Solve CAPTCHA, then click login...');
    await page.waitForURL('**/dashboard', { timeout: 90000 }); // wait until logged in

    await context.storageState({ path: authFile });
    console.log('✅ Authentication saved to auth.json');
  } else {
    // Use saved session
    const newContext = await context.browser().newContext({ storageState: authFile });
    const newPage = await newContext.newPage();
    await newPage.goto('https://qav2.cybermart.com/dashboard');

    if (!newPage.url().includes('dashboard')) {
      console.log('❌ Session expired or invalid. Deleting auth.json...');
      fs.unlinkSync(authFile);
      throw new Error('Session invalid — auth.json deleted. Please re-run the test to log in again.');
    }

    await expect(newPage).toHaveURL(/.*dashboard/);
    console.log('✅ Logged in with saved session');
    await newContext.close();
  }
});
