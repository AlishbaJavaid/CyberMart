import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const STORAGE_FILE = 'buyer-session.json';
const BUYER_URL = 'https://qabuyer.cybermart.com/';
const PROFILE_API = 'https://qaapi.cybermart.com/api/v1/user/profile/get-profile';
const DEFAULT_LOCATION = { latitude: 24.8607, longitude: 67.0011, accuracy: 100 };

test('Buyer Login with Saved Session+Location and Placing Order', async () => {
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    geolocation: DEFAULT_LOCATION,
    permissions: ['geolocation'],
    storageState: fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : undefined,
  });

  const page = await context.newPage();

  console.log('🔹 Buyer session file exists:', fs.existsSync(STORAGE_FILE));

  // Inject mock location into localStorage
  await page.addInitScript(() => {
    localStorage.setItem(
      'user-location-storage',
      JSON.stringify({
        state: {
          coords: { lat: 24.8607, lng: 67.0011 },
          locationStateName: "Sindh",
          locationCountryName: "Pakistan"
        }
      })
    );
  });

  // Navigate to buyer page
  await page.goto(BUYER_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('header, main, #app').first().waitFor({ state: 'visible', timeout: 20000 });

  const cookies = await context.cookies();
  console.log('🔹 Current cookies:', cookies);

  // Check if buyer is already logged in
  const isLoggedIn = await page.evaluate(() => !!localStorage.getItem('userProfileData'));
  console.log('🔹 Is buyer already logged in?', isLoggedIn);

  if (!isLoggedIn) {
    console.log('🔹 Logging in buyer manually...');

    const loginParagraph = page.getByRole('paragraph').filter({ hasText: 'Login / Register' });
    await loginParagraph.click();

    const emailInput = page.getByRole('textbox', { name: 'Phone/Email *' });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await loginParagraph.click();
      try {
        await expect(emailInput).toBeVisible({ timeout: 5000 });
        break;
      } catch {
        if (attempt === 4) throw new Error('Login modal did not appear after 3 attempts');
        console.log(`⚠️ Attempt ${attempt} failed, retrying...`);
      }
    }
    await emailInput.fill('alishba+11@cybermart.com');

    const continueButton = page.getByRole('button', { name: 'Continue' });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await continueButton.click();
      try {
        const passwordInput = page.getByTestId('password');
        await expect(passwordInput).toBeVisible({ timeout: 5000 });
        break;
      } catch {
        if (attempt === 4) throw new Error('Continue button did not proceed after 3 attempts');
        console.log(`⚠️ Attempt ${attempt} to click Continue failed, retrying...`);
      }
    }

    const passwordInput = page.getByTestId('password');
    await passwordInput.fill('Alishba@321');

    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for profile API
    await page.waitForResponse(response =>
      response.url() === PROFILE_API && response.status() === 200,
      { timeout: 20000 }
    );

    await page.waitForTimeout(2000);
    console.log('✅ Manual login completed');

    // Save cookies + localStorage in Playwright storage state format
    await context.storageState({ path: STORAGE_FILE });
    console.log('💾 Storage state saved');
  } else {
    // Optional: wait for profile API if already logged in
    await page.waitForResponse(response =>
      response.url() === PROFILE_API && response.status() === 200,
      { timeout: 20000 }
    );
  }

  // ==== Search product ====
  const productName = 'my first product (with template 2)';
  const searchBox = page.getByRole('textbox', { name: 'Search Product' });
  await searchBox.fill(productName);
  await searchBox.press('Enter');

  // Wait for product link
  const productLink = page.getByRole('link', { name: productName }).first();
  await expect(productLink).toBeVisible({ timeout: 15000 });

// Click and capture the new tab
const [productPage] = await Promise.all([
  page.context().waitForEvent('page'),
  productLink.click(), // opens in a new tab
]);

// Wait until the product page loads
await productPage.waitForLoadState('domcontentloaded');

// Wait for product title on the new tab
await productPage.locator('h1', { hasText: productName }).waitFor({ state: 'visible', timeout: 15000 });

  // ==== Checkout flow ====
  await productPage.getByRole('button', { name: 'Add to cart' }).click();
  await productPage.getByRole('button', { name: 'Go To Cart' }).click();

// Wait for "Proceed to Checkout" to be visible + enabled, then click
const proceedBtn = productPage.getByRole('button', { name: 'Proceed to Checkout' });
await expect(proceedBtn).toBeVisible({ timeout: 20000 });
await expect(proceedBtn).toBeEnabled();
await proceedBtn.click();

  // Random shipping option
  const shippingOptions = await productPage.locator('text=STANDARD, text=EXPEDITED, text=FREE').all();
  if (shippingOptions.length > 0) {
    const randomIndex = Math.floor(Math.random() * shippingOptions.length);
    await shippingOptions[randomIndex].click();
  }

// Capture totals
// helper to read "label / value" rows like:
// <div class="flex justify-between"><span>Item(s) Total</span><span>$ 1.09</span></div>
async function getRowValue(page, label, timeout = 10000) {
  const row = page.locator('div.flex.justify-between', { hasText: label }).first();
  await expect(row).toBeVisible({ timeout }); // ensure that specific row is visible
  const value = await row.locator('span').nth(1).innerText(); // second span = value
  return value.trim();
}

function normalizeAmount(text) {
  // remove currency symbols / commas / non-numeric chars (keeps - and .)
  return (text || '').replace(/[^\d.-]/g, '').trim();
}

// ===== capture totals =====
const itemTotalRaw = await getRowValue(productPage, 'Item(s) Total');
const shippingRaw = await getRowValue(productPage, 'Shipping & Handling');
const shippingDiscountRaw = await getRowValue(productPage, 'Shipping Discount');
const totalRaw = await getRowValue(productPage, 'Total');

console.log({ itemTotalRaw, shippingRaw, shippingDiscountRaw, totalRaw });

const itemTotal = normalizeAmount(itemTotalRaw);
const shipping = normalizeAmount(shippingRaw);
const shippingDiscount = normalizeAmount(shippingDiscountRaw);
const total = normalizeAmount(totalRaw);

// assert we actually captured numbers
expect(itemTotal).not.toBe('');
expect(total).not.toBe('');

  // Place order
  await productPage.getByRole('button', { name: 'Place Order' }).click();
  await productPage.getByRole('textbox', { name: 'Email' }).fill('alishba@cybermart.com');
  await productPage.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242');
  await productPage.getByRole('textbox', { name: 'Expiration' }).fill('11 / 29');
  await productPage.getByRole('textbox', { name: 'CVC' }).fill('111');
  await productPage.getByRole('textbox', { name: 'Cardholder name' }).fill('Testing');

// Click submit
await Promise.all([
  productPage.waitForURL(/success\?orderNo=CM-\d+/, { timeout: 20000 }),
  productPage.getByTestId('hosted-payment-submit-button').click(),
]);

// Get current URL
const currentUrl = productPage.url();
console.log('✅ Landed on URL:', currentUrl);

// Validate success URL and extract order number
await expect(productPage).toHaveURL(/success\?orderNo=CM-\d+/);

const orderNoMatch = currentUrl.match(/orderNo=(CM-\d+)/);
expect(orderNoMatch).not.toBeNull();
const orderNo = orderNoMatch[1];
console.log(`✅ Order placed: ${orderNo}`);

// === Capture totals on Success Page ===
const successItemTotalRaw = await getRowValue(productPage, 'Item(s) Total');
const successShippingRaw = await getRowValue(productPage, 'Shipping & Handling');
const successShippingDiscountRaw = await getRowValue(productPage, 'Shipping Discount');
const successTotalRaw = await getRowValue(productPage, 'Total');

const successItemTotal = normalizeAmount(successItemTotalRaw);
const successShipping = normalizeAmount(successShippingRaw);
const successShippingDiscount = normalizeAmount(successShippingDiscountRaw);
const successTotal = normalizeAmount(successTotalRaw);

// === Compare Success Page totals with Checkout totals ===
console.log('🔎 Comparing Checkout vs Success Page totals...');
console.log({
  checkout: { itemTotal, shipping, shippingDiscount, total },
  success: { successItemTotal, successShipping, successShippingDiscount, successTotal },
});

expect(successItemTotal).toBe(itemTotal);
expect(successShipping).toBe(shipping);
expect(successShippingDiscount).toBe(shippingDiscount);
expect(successTotal).toBe(total);

console.log('✅ Success Page totals match Checkout totals');

  // // Navigate to orders
  // await productPage.getByText('Orders & Account').click();
  // await productPage.getByRole('link', { name: 'Orders' }).click();

  // === Navigate to Orders ===
const ordersAccount = productPage.getByText('Orders & Account', { exact: true });
await expect(ordersAccount).toBeVisible({ timeout: 10000 });
await ordersAccount.click();

// Look for "Orders" link (case-insensitive, handles extra text like "My Orders" or "Orders (1)")
const ordersLink = productPage.getByRole('link', { name: /Orders/i }).first();
await expect(ordersLink).toBeVisible({ timeout: 10000 });
console.log('➡️ Navigating via link:', await ordersLink.innerText());
await ordersLink.click();

  await productPage.getByText(orderNo).click();
  await productPage.locator('.text-paragraph-sm.text-\\[\\#17181B\\].font-bold.cursor-pointer').first().click();

// === Capture totals on Order Detail Page ===
async function getDetailRowValue(page, label, timeout = 10000) {
  const row = page.locator('div.flex.justify-between', { hasText: label }).first();
  await expect(row).toBeVisible({ timeout });
  const value = await row.locator('span').nth(1).innerText();
  return normalizeAmount(value);
}

const detailItemTotal = await getDetailRowValue(productPage, 'Item Subtotal');
const detailShipping = await getDetailRowValue(productPage, 'Shipping');
const detailShippingDiscount = await getDetailRowValue(productPage, 'Shipping Discount');
const detailTotal = await getDetailRowValue(productPage, 'Total');

console.log({ detailItemTotal, detailShipping, detailShippingDiscount, detailTotal });

// === Compare Order Details totals with Checkout + Success Page totals ===
expect(detailItemTotal).toBe(itemTotal);
expect(detailItemTotal).toBe(successItemTotal);

expect(detailShipping).toBe(shipping);
expect(detailShipping).toBe(successShipping);

expect(detailShippingDiscount).toBe(shippingDiscount);
expect(detailShippingDiscount).toBe(successShippingDiscount);

expect(detailTotal).toBe(total);
expect(detailTotal).toBe(successTotal);

});
