import { test, expect } from '@playwright/test';
import fs from 'fs';

import path from 'path';

// Helper: resolve image file path
const imagePath = (filename) => path.join(__dirname, '../test-data/Images', filename);


test('Seller login flow + Add Simple Product (with auto-auth)', async ({ browser }) => {
  test.setTimeout(120000); // allow up to 2 mins for manual CAPTCHA

  const authFile = 'auth.json';
  let context;
  let page;

  // ----- Fresh Login -----
  async function freshLogin() {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();

    await pg.goto('https://qav2.cybermart.com/');
    await pg.getByTestId('login-dashboard').click();

    await pg.getByTestId('emailOrPhone').fill('alishba+1@cybermart.com');
    await pg.getByTestId('password').fill('Alishba@4321');

    console.log('⚠️ Solve CAPTCHA manually, then click login...');
    await pg.waitForURL('**/dashboard', { timeout: 90000 });

    // Ensure dashboard loaded
    await expect(pg.getByText('Inventory Management')).toBeVisible({ timeout: 15000 });

    // Save session
    await ctx.storageState({ path: authFile });
    console.log('✅ Authentication saved to auth.json');

    return { context: ctx, page: pg };
  }

  // ----- Use Saved Session or Fresh Login -----
  if (!fs.existsSync(authFile)) {
    ({ context, page } = await freshLogin());
  } else {
    context = await browser.newContext({ storageState: authFile });
    page = await context.newPage();

    await page.goto('https://qav2.cybermart.com/dashboard');
    await page.waitForLoadState('networkidle');

    // Session expired → re-login
    if (page.url().includes('sign-in') || page.url().includes('login')) {
      console.log('❌ Session expired. Deleting auth.json...');
      fs.unlinkSync(authFile);
      await context.close();
      ({ context, page } = await freshLogin());
    } else {
      await expect(page.getByText('Inventory Management')).toBeVisible({ timeout: 15000 });
      console.log('✅ Logged in with saved session');
    }
  }

  // -------- Add Product Flow --------
  await page.getByText('Inventory Management').click();
  await page.waitForLoadState('networkidle');

  // Double check again if redirected
  if (page.url().includes('sign-in') || page.url().includes('login')) {
    console.log('❌ Session expired while opening Inventory. Deleting auth.json...');
    fs.unlinkSync(authFile);
    await context.close();
    ({ context, page } = await freshLogin());
    await page.getByText('Inventory Management').click();
  }

  // Now safe to proceed
  await expect(page.getByText('Create New Product')).toBeVisible({ timeout: 15000 });
  await page.getByText('Create New Product').click();

// Function to generate random product name
function getRandomProductName(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let name = '';
  for (let i = 0; i < length; i++) {
    name += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'Product_' + name; // Prefix to make it clear
}

// Generate a random product name with 12+ characters
const randomProductName = getRandomProductName(12);

// Fill product name in the input
await page.getByRole('textbox', { name: 'Enter Product Name *' }).fill(randomProductName);

await page.getByRole('textbox', { name: 'Category' }).click();
await page.getByText('Weight Storage Racks').click();

await page.getByRole('combobox', { name: 'Select Condition' }).first().click();
await page.getByRole('option', { name: 'New' }).click();

// Both Condition and Brand are comboboxes with same accessible name
const comboBoxes = page.getByRole('combobox', { name: 'Select Condition' });
const brandDropdown = comboBoxes.nth(1); // 0 = Condition, 1 = Brand

await brandDropdown.click();
await page.getByRole('option', { name: 'Brand A' }).click();
// Move to Description & Features step
await page.getByRole('button', { name: 'Next' }).click();


// wait for the section header so we know the step loaded
await page.locator('h6:has-text("Add Product Features")').first().waitFor({ state: 'visible' });

const featureInput = page.locator(
  'xpath=//h6[contains(normalize-space(.),"Add Product Features")]/following::input[1]'
);
await expect(featureInput).toBeVisible();
await featureInput.fill('6 Pack Black & Grey Crew T-Shirts');
await page.getByRole('button', { name: '+ Add' }).click();
await page.waitForTimeout(1000);

// reuse the same input to add more features
await featureInput.fill('Stays tucked with a Layflat Collar');
await page.getByRole('button', { name: '+ Add' }).click();
await page.waitForTimeout(1000);

await featureInput.fill('Wicks moisture');
await page.getByRole('button', { name: '+ Add' }).click();
await page.waitForTimeout(1000);

await featureInput.fill('Collar keeps its shape wash after wash');
await page.getByRole('button', { name: '+ Add' }).click();
await page.waitForTimeout(1000);

await featureInput.fill('Tag-free for all-day comfort');
await page.getByRole('button', { name: '+ Add' }).click();
await page.waitForTimeout(1000);

// Short description editor (first Quill)
const shortDescriptionEditor = page.locator(
  'xpath=//h6[contains(.,"Enter Short Description")]/following::div[contains(@class,"ql-editor")][1]'
);
await expect(shortDescriptionEditor).toBeVisible();
await shortDescriptionEditor.fill(
  "Fruit of the Loom men's crews stay tucked, feature a layflat collar, wick moisture, and provide tag-free all-day comfort."
);
await page.waitForTimeout(1000);

// Long description editor (second Quill)
const longDescriptionEditor = page.locator(
  'xpath=//h6[contains(.,"Enter Long Description")]/following::div[contains(@class,"ql-editor")][1]'
);
await expect(longDescriptionEditor).toBeVisible();
await longDescriptionEditor.fill(
  "Fruit of the Loom men's crews work great alone or to add an extra layer under a button-down or polo shirt. This shirt eliminates ride-up, it stays neatly tucked so you can go about your busy day with confidence. They are designed to maintain comfort and softness even after many washes. The improved, double-stitched collar stays flat and keeps its shape, providing a consistent look. This Fruit of the Loom t-shirt features a tag free designed to provide all-day comfort. There are soft covered seams on the neck and shoulders for extra comfort. Wear layered or by itself. Available in a variety of sizes, you can choose the ideal one for your body."
);
await page.waitForTimeout(1000);

// Continue to upload images step 
await page.getByRole('button', { name: 'Next' }).click();

// // 8 images to upload
// const imageFiles = [
//   '71UAd8cY5NL._AC_SX569_.jpg',
//   '71UZGSrlE5L._AC_SL1500_.jpg',
//   'Media (6).jpg',
//   '71haUItpcKL._SL1500_.jpg',
//   'Media (5).jpg',
//   '7197LHi3pjL._AC_SL1500_.jpg',
//   '817UJvB1BrL._SL1500_.jpg',
//   'Media (7).jpg',
// ].map(file => imagePath(file));

// // Step 1: Click "Upload Image 1" (opens sidebar)
// await page.getByRole('button', { name: 'Upload Image 1' }).click();

// // Step 2: Attach all 8 files at once to the file input
// const browseInput = page.locator('input[type="file"]').last();
// await browseInput.setInputFiles(imageFiles);

// // Proceed with upload
// await page.getByRole('button', { name: 'Proceed to upload' }).click();

// Pool of images
const allImageFiles = [
  '71UAd8cY5NL._AC_SX569_.jpg',
  '71UZGSrlE5L._AC_SL1500_.jpg',
  'Media (6).jpg',
  '71haUItpcKL._SL1500_.jpg',
  'Media (5).jpg',
  '7197LHi3pjL._AC_SL1500_.jpg',
  '817UJvB1BrL._SL1500_.jpg',
  'Media (7).jpg',
].map(file => imagePath(file));

// Function to get random images
function getRandomImages(min = 3, max = 8) {
  // Pick random count between min and max
  const count = Math.floor(Math.random() * (max - min + 1)) + min;

  // Shuffle images and pick "count" number
  const shuffled = [...allImageFiles].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// Generate random set of images
//const imageFiles = getRandomImages(3, 8); // will pick between 3 and 8 images
const imageFiles = getRandomImages(2, 2); // always 2 images

// Step 1: Click "Upload Image 1" (opens sidebar)
await page.getByRole('button', { name: 'Upload Image 1' }).click();

// Step 2: Attach selected random files
const browseInput = page.locator('input[type="file"]').last();
await browseInput.setInputFiles(imageFiles);

// Step 3: Proceed with upload
await page.getByRole('button', { name: 'Proceed to upload' }).click();

// Pause
await page.waitForTimeout(1000);

// Continue
await page.getByRole('button', { name: 'Next' }).click();

// Flavor
await page.getByRole('textbox', { name: 'Flavor' }).fill('falsa');
await page.waitForTimeout(1000);

// Pack Size
await page.getByRole('textbox', { name: 'Enter Pack Size' }).fill('small');
await page.waitForTimeout(1000);

// Color
await page.getByRole('textbox', { name: 'Enter Color' }).fill('blue');
await page.waitForTimeout(1000);

// Generate random SKU
const randomSku = 'sku-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

// Fill SKU
await page.getByRole('textbox', { name: 'Enter Seller SKU' }).fill(randomSku);

await page.waitForTimeout(1000);

// Prices
await page.getByPlaceholder('Enter List Price').fill('100');
await page.waitForTimeout(1000);

await page.getByPlaceholder('Enter Your Price').fill('60');
await page.waitForTimeout(1000);

await page.getByPlaceholder('Enter Promo Price').fill('50');
await page.waitForTimeout(1000);

// Open calendar only once
await page.getByTestId('CalendarMonthIcon').click();

// Define dynamic dates
const now = new Date();
const promoStartDay = now.getDate().toString();

const tomorrowDate = new Date();
tomorrowDate.setDate(now.getDate() + 1);
const tomorrow = tomorrowDate.getDate().toString();

// Start Date = Today
await page.getByRole('button', { name: 'Choose date' }).first().click();
await page.getByRole('gridcell', { name: promoStartDay }).click();
await page.waitForTimeout(1000);   // 👀 pause after selecting start date

// End Date = Tomorrow
await page.getByRole('button', { name: 'Choose date' }).nth(1).click();
if (tomorrowDate.getMonth() !== now.getMonth()) {
  await page.getByRole('button', { name: 'Next month' }).click();
}
await page.getByRole('gridcell', { name: tomorrow }).click();
await page.waitForTimeout(1000);   // 👀 pause after selecting end date

// Apply changes to close calendar
await page.getByRole('button', { name: 'Apply Changes' }).click();
await page.waitForTimeout(1000);   // 👀 pause after applying

// Quantity
await page.getByPlaceholder('Enter Quantity').fill('100');
await page.waitForTimeout(1000);

// Go next
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForTimeout(1000);

// Select Return Days
await page.getByRole('combobox', { name: 'Select Return Days' }).click();
await page.getByRole('option', { name: '3 Days' }).click();
await page.waitForTimeout(1000);

// Select radio: Both
await page.getByRole('radio', { name: 'Both' }).check();
await page.waitForTimeout(1000);

// Select warranty options
await page.getByRole('combobox', { name: 'Select Return Days 3 Days' }).nth(1).click();
await page.getByRole('option', { name: '3 Months' }).click();
await page.waitForTimeout(1000);

await page.getByRole('combobox', { name: 'Select Return Days 3 Days' }).nth(2).click();
await page.getByRole('option', { name: '7 Days' }).click();
await page.waitForTimeout(1000);

// Fill warranty policy
await page.getByRole('textbox', { name: 'Warranty Policy *' }).click();
await page.getByRole('textbox', { name: 'Warranty Policy *' }).fill('Testing Warranty Policy');
await page.waitForTimeout(1000);

// Radio: No
await page.getByRole('radio', { name: 'No', exact: true }).check();

// Next button
await page.getByRole('button', { name: 'Next' }).click();

// Pause 2 seconds
await page.waitForTimeout(1000);

await page.getByRole('combobox', { name: 'Package Type' }).click();
await page.waitForTimeout(1000);

await page.getByRole('option', { name: 'Flat Rate Boxes' }).click();
await page.waitForTimeout(1000);

await page.getByRole('combobox', { name: 'Package Type Flat Rate Boxes' }).nth(1).click();
await page.getByRole('option', { name: 'Small' }).click();
await page.waitForTimeout(1000);

await page.getByRole('heading', { name: 'Shipping Handling' }).click();
await page.getByRole('radio', { name: 'Seller Shipment' }).check();
await page.waitForTimeout(1000);

// Open the first Shipping Template combobox
const shippingTemplateDropdown = page.getByRole('combobox', { name: 'Template One (Default)' }).first();
await shippingTemplateDropdown.click();

// Select desired option
await page.getByRole('option', { name: 'Template One (Default)' }).click();

// Assert selection
await expect(shippingTemplateDropdown).toHaveText(/Template One/);

await page.waitForTimeout(1000);

// Select checkbox
await page.getByRole('checkbox', { name: 'None' }).check();
await page.waitForTimeout(1000);

// Add tags 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).click(); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).fill('tag 1'); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).press('Enter'); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).fill('tag 2'); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).press('Enter'); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).fill('tag 3'); 
// await page.getByRole('textbox', { name: 'Type and hit enter' }).press('Enter');

// Add random tags
const tagInput = page.getByRole('textbox', { name: 'Type and hit enter' });

// Pool of possible tags
const tagPool = ['electronics', 'fashion', 'gadgets', 'accessories', 'home', 'beauty', 'testing'];

// Function to pick random tags without mutating the original array
function getRandomTags(count) {
  const poolCopy = [...tagPool]; // clone the array
  const randomTags = [];

  for (let i = 0; i < count && poolCopy.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * poolCopy.length);
    randomTags.push(poolCopy.splice(randomIndex, 1)[0]); // remove from poolCopy to avoid duplicates
  }

  return randomTags;
}

// Generate 3 random tags
const randomTags = getRandomTags(3);

for (const tag of randomTags) {
  await tagInput.fill(tag);
  await tagInput.press('Enter');
}

await page.waitForTimeout(1000);

// Final Create button
await page.getByRole('button', { name: 'Create' }).click();

// ✅ Verify success message
await expect(page.getByText('Successfully Submitted')).toBeVisible();
await expect(page.getByText('Your product has been submitted to CyberMart for approval. Once approved, the product will be successfully added to the inventory')).toBeVisible();
await expect(page.getByText('To view list,click here')).toBeVisible();

// If "click here" is an actual link/button → then click it
await page.getByText('click here').click();

});