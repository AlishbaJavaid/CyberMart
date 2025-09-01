import { expect } from '@playwright/test';
import fs from 'fs';

const adminAuthFile = 'adminAuth.json';
let adminContext, adminPage;

export async function adminLogin(browser) {
  // ----- Fresh Login -----
  async function adminFreshLogin() {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();

    await pg.goto('https://qaadminv2.cybermart.com/sign-in');
    await pg.getByTestId('emailOrPhone').fill('admin@cybermart.com');
    await pg.getByTestId('password').fill('Rizwan@123');
    console.log('⚠️ Solve Admin CAPTCHA manually...');
    await pg.getByTestId('login-submit').click();

    // Ensure dashboard loaded
    await expect(pg.getByText('Inventory Management')).toBeVisible({ timeout: 15000 });

    // Save session
    await ctx.storageState({ path: adminAuthFile });
    console.log('✅ Admin auth saved');
    return { context: ctx, page: pg };
  }

  // Use saved session or fresh login
  if (!fs.existsSync(adminAuthFile)) {
    ({ context: adminContext, page: adminPage } = await adminFreshLogin());
  } else {
    adminContext = await browser.newContext({ storageState: adminAuthFile });
    adminPage = await adminContext.newPage();

    await adminPage.goto('https://qaadminv2.cybermart.com/dashboard');
    await adminPage.waitForLoadState('networkidle');

    if (adminPage.url().includes('sign-in') || adminPage.url().includes('login')) {
      console.log('❌ Admin session expired, re-login...');
      fs.unlinkSync(adminAuthFile);
      await adminContext.close();
      ({ context: adminContext, page: adminPage } = await adminFreshLogin());
    } else {
      console.log('✅ Admin logged in with saved session');
    }
  }

  return { adminContext, adminPage };
}

export async function approveProduct(adminPage, productName) {
  // Go to Inventory Management
  await adminPage.getByRole('button', { name: 'Inventory Management' }).click();

  // 🔎 Find row by Product Name
  const row = adminPage.getByRole('row', { name: new RegExp(productName, 'i') });
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByLabel('icon-button').click();

  // Review + Approve
  await adminPage.getByRole('menuitem', { name: 'Review' }).click();
  await adminPage.getByRole('button', { name: 'Approve' }).click();
  await adminPage.getByRole('button', { name: 'Approve' }).click();

  console.log(`✅ Product [${productName}] approved successfully by Admin`);
}
