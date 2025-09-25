// AdminSearchProduct.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';

const adminAuthFile = 'admin-auth.json';

// Helper: fresh admin login
async function adminFreshLogin(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('https://qaadminv2.cybermart.com/sign-in');
  await page.getByTestId('emailOrPhone').fill('admin@cybermart.com');
  await page.getByTestId('password').fill('Rizwan@123');

  console.log('⚠️ Solve Admin CAPTCHA manually...');
  await page.getByTestId('login-submit').click();

  await expect(page.getByRole('link', { name: 'Inventory Management' }))
    .toBeVisible({ timeout: 120_000 });

  await ctx.storageState({ path: adminAuthFile });
  console.log('✅ Admin auth saved');
  return { context: ctx, page };
}

// Helper: get admin page with session handling
async function getAdminPage(browser) {
  let context, page;

  if (!fs.existsSync(adminAuthFile)) {
    ({ context, page } = await adminFreshLogin(browser));
  } else {
    context = await browser.newContext({ storageState: adminAuthFile });
    page = await context.newPage();

    await page.goto('https://qaadminv2.cybermart.com/dashboard');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('sign-in') || page.url().includes('login')) {
      console.log('❌ Admin session expired, re-login...');
      fs.unlinkSync(adminAuthFile);
      await context.close();
      ({ context, page } = await adminFreshLogin(browser));
    } else {
      console.log('✅ Admin logged in with saved session');
    }
  }

  return page;
}

// Test: search product and click
test('Admin: search product and open variants', async ({ browser }) => {
  const page = await getAdminPage(browser);

  // Navigate to Inventory Management
  await page.getByRole('link', { name: 'Inventory Management' }).click();

  // Search product
  const productName = 'Product_P9diztwPnqfJ';
  const searchBox = page.getByRole('textbox', { name: 'Search by product name, UPC, CSIN' });
  await searchBox.click();
  await searchBox.fill(productName);

  await page.getByRole('button', { name: 'Search' }).click();

  // Wait for search results table and at least one row
const resultsTable = page.locator('table:has-text("Product Name")');
await expect(resultsTable).toBeVisible({ timeout: 10000 });

const firstRow = resultsTable.locator('tr').nth(1); // skip header row
await expect(firstRow).toBeVisible({ timeout: 10000 });

// Now locate the button
const viewVariants = page.getByText('View all variations').first();

// Increase timeout to 10 seconds
await expect(viewVariants).toBeVisible({ timeout: 10000 });

await viewVariants.click();

// Wait for the child rows to appear
const activeRowSelector = `tr:has-text("${productName}"):has-text("Active")`;
await page.waitForSelector(activeRowSelector, { timeout: 10000 });

const activeRow = page.locator(activeRowSelector);
await expect(activeRow).toBeVisible({ timeout: 30000 });

console.log(`✅ Product [${productName}] status is Active`)

});
