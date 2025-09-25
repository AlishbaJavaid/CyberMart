import { test, expect } from '@playwright/test';
import fs from 'fs';

const STORAGE_STATE = 'buyer-session.json';

test('buyer places order and validates totals', async ({ browser }) => {
  let context;
  if (fs.existsSync(STORAGE_STATE)) {
    // ✅ Load existing session
    context = await browser.newContext({ storageState: STORAGE_STATE });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();

  // Load page first
  await page.goto('https://qabuyer.cybermart.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // ✅ Set location AFTER load
  await page.evaluate(() => {
    localStorage.setItem(
      'user-location-storage',
      JSON.stringify({
        state: {
          coords: { lat: 24.8607, lng: 67.0011 },
          locationStateName: 'Sindh',
          locationCountryName: 'Pakistan',
        },
      })
    );
  });

  // ==== Ensure logged in ====
  const loginBtn = page.getByText('Login / Register');
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click();
    await page.getByRole('textbox', { name: 'Phone/Email *' }).fill('alishba+11@cybermart.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('password').fill('Alishba@321');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait until "Login / Register" disappears
    await expect(loginBtn).toHaveCount(0, { timeout: 20000 });

    // Save fresh session (includes login + location)
    await context.storageState({ path: STORAGE_STATE });
  }

  // ==== Search product ====
  const productName = 'my first product (with template 2)';
  const searchBox = page.getByRole('textbox', { name: 'Search Product' });
  await searchBox.fill(productName);
  await searchBox.press('Enter');

  // Wait for product link
  const productLink = page.getByRole('link', { name: productName }).first();
  await expect(productLink).toBeVisible({ timeout: 15000 });

  // Click product and wait for detail page
  await Promise.all([
    page.waitForURL(/\/product\//, { timeout: 15000 }),
    productLink.click(),
  ]);

  const page1 = page;

  // ==== Checkout flow ====
  await page1.getByRole('button', { name: 'Add to cart' }).click();
  await page1.getByRole('button', { name: 'Go To Cart' }).click();
  await page1.getByRole('button', { name: 'Proceed to Checkout' }).click();

  // Random shipping option
  const shippingOptions = await page1.locator('text=STANDARD, text=EXPEDITED, text=FREE').all();
  if (shippingOptions.length > 0) {
    const randomIndex = Math.floor(Math.random() * shippingOptions.length);
    await shippingOptions[randomIndex].click();
  }

  // Capture totals
  const itemTotal = await page1.locator('text=Item(s) Total').locator('xpath=following-sibling::span').textContent();
  const shipping = await page1.locator('text=Shipping & Handling').locator('xpath=following-sibling::span').textContent();
  const shippingDiscount = await page1.locator('text=Shipping Discount').locator('xpath=following-sibling::span').textContent();
  const total = await page1.locator('span', { hasText: /^Total$/ }).locator('xpath=following-sibling::span').textContent();

  // Place order
  await page1.getByRole('button', { name: 'Place Order' }).click();
  await page1.getByRole('textbox', { name: 'Email' }).fill('alishba@cybermart.com');
  await page1.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242');
  await page1.getByRole('textbox', { name: 'Expiration' }).fill('11 / 29');
  await page1.getByRole('textbox', { name: 'CVC' }).fill('111');
  await page1.getByRole('textbox', { name: 'Cardholder name' }).fill('Testing');
  await page1.getByTestId('hosted-payment-submit-button').click();

  // Wait for order success
  await page1.waitForURL(/success\?orderNo=CM-\d+/);
  const url = page1.url();
  const orderNoMatch = url.match(/orderNo=(CM-\d+)/);
  expect(orderNoMatch).not.toBeNull();
  const orderNo = orderNoMatch[1];

  // Navigate to orders
  await page1.getByText('Orders & Account').click();
  await page1.getByRole('link', { name: 'Orders' }).click();
  await page1.getByText(orderNo).click();
  await page1.locator('.text-paragraph-sm.text-\\[\\#17181B\\].font-bold.cursor-pointer').first().click();

  // Validate totals
  const orderItemTotal = await page1.locator('text=Item Subtotal').locator('xpath=following-sibling::span').textContent();
  const orderShipping = await page1.locator('text=Shipping', { exact: true }).locator('xpath=following-sibling::span').textContent();
  const orderShippingDiscount = await page1.locator('text=Shipping Discount').locator('xpath=following-sibling::span').textContent();
  const orderTotal = await page1.locator('text=Total', { exact: true }).locator('xpath=following-sibling::span').textContent();

  expect(orderItemTotal).toBe(itemTotal);
  expect(orderShipping).toBe(shipping);
  expect(orderShippingDiscount).toBe(shippingDiscount);
  expect(orderTotal).toBe(total);
});
