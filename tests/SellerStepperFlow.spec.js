import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function randomDigits(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

function randomEmail() {
  return `alishba+1${randomString(6)}@cybermart.com`;
}

const sellersPath = path.join(__dirname, 'sellers.json');
const sellers = JSON.parse(fs.readFileSync(sellersPath, 'utf8'));

// Decide which seller to use (env var OR default to lastSignup)
const sellerType = process.env.SELLER || 'lastSignup';
const { email, password } = sellers[sellerType];

const storagePath = path.join(__dirname, `${sellerType}-storage.json`);

// --- Helper for safe "Save and Next" navigation ---
async function saveAndNext(page, nextStepHeading) {
  const saveBtn = page.getByRole('button', { name: 'Save and Next' });

  await expect(saveBtn).toBeVisible({ timeout: 30000 });
  await expect(saveBtn).toBeEnabled({ timeout: 30000 });

  await saveBtn.click({ force: true });

  if (nextStepHeading) {
    await expect(
      page.getByRole('heading', { name: nextStepHeading })
    ).toBeVisible({ timeout: 60000 });
  } else {
    await page.waitForURL(/stepper|dashboard/, { timeout: 60000 });
  }
}

// Run: npx cross-env SELLER=customSeller npx playwright test tests/sellerstepperflow.spec.js --headed
test('Continue stepper flow with existing user', async () => {
  test.setTimeout(5 * 60 * 1000);
  test.slow();

  let context;
  let page;

  // --- Use saved session if exists ---
  if (fs.existsSync(storagePath)) {
    console.log(`🔑 Using saved session for seller: ${sellerType}`);
    context = await chromium.launchPersistentContext('', { storageState: storagePath, headless: false });
    page = await context.newPage();
    await page.goto('https://seller.cybermart.com/sign-in');
  } else {
    console.log(`⚠️ No saved session found, login required`);
    context = await chromium.launchPersistentContext('', { headless: false });
    page = await context.newPage();
    await page.goto('https://seller.cybermart.com/sign-in', { waitUntil: 'domcontentloaded', timeout: 180000 });

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('emailOrPhone')).toBeVisible();
    await expect(page.getByTestId('password')).toBeVisible();

    // --- Manual reCAPTCHA solve ---
    console.log('⚠️ Solve reCAPTCHA manually...');
    await expect(page.locator('textarea[name="g-recaptcha-response"]'))
      .toHaveValue(/.+/, { timeout: 180000 });
    console.log('✅ reCAPTCHA solved.');

    await page.getByTestId('emailOrPhone').fill(email);
    await page.getByTestId('password').fill(password);
    console.log(`🔑 Logging in with seller: ${sellerType} (${email})`);

    await page.getByRole('button', { name: 'Continue' }).click();

    // Save session for future runs
    await context.storageState({ path: storagePath });
    console.log(`💾 Seller session saved to: ${storagePath}`);
  }

  // --- Wait for any stepper heading to appear ---
  await expect(
    page.getByRole('heading', {
      name: /Account Type|Business Information|Primary Contact Information|Billing|Store|Verification/,
    })
  ).toBeVisible({ timeout: 180000 });

  console.log(`✅ Landed on: ${page.url()}`);

  // OTP step (if shown)
  const otpField = page.getByRole('textbox', { name: 'Enter OTP *' });
  if (await otpField.isVisible().catch(() => false)) {
    console.log('📩 OTP required, entering code...');
    await otpField.fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('button', { name: "Let's Start" }).click();
  }

  // --- Handle Welcome page ---
  if (page.url().includes('/welcome')) {
    console.log('👋 Seller landed on Welcome page');
    await page.getByRole('button', { name: "Let's Start" }).click();
    await page.waitForURL(/stepper/, { timeout: 60000 });
    console.log(`➡️ Redirected to stepper: ${page.url()}`);
  }

  // Detect current step
  const stepperSteps = [
    'Account Type',
    'Business Information',
    'Primary Contact Information',
    'Billing',
    'Store',
    'Verification'
  ];

  let currentStep = null;
  for (const step of stepperSteps) {
    if (await page.getByRole('heading', { name: step }).isVisible().catch(() => false)) {
      currentStep = step;
      break;
    }
  }

  if (currentStep) {
    console.log(`📌 Seller resumed at step: ${currentStep}`);
  } else {
    console.log('⚠️ No stepper step detected, might be dashboard or unexpected page.');
  }

  // --- Account Type step ---
  if (currentStep === 'Account Type') {
    console.log('⚙️ Handling Account Type step...');
    await page.locator('div').filter({ hasText: /^PrivatelyOwn Business$/ }).first().click();
    await page.getByRole('heading', { name: 'Business Account' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree and Continue' }).click();
    console.log('✅ Account Type step completed');
  }

  // --- Business Information step ---
  if (currentStep === 'Business Information') {
    console.log('📝 Filling Business Information step...');
    await expect(page.getByRole('heading', { name: 'Business Information' })).toBeVisible();

    const stateZipMap = {
      Alaska: ['99501', '99502', '99503'],
      California: ['90001', '94105', '95814'],
      NewYork: ['10001', '11201', '14604'],
      Texas: ['73301', '75001', '77001'],
      Florida: ['33101', '32801', '32202']
    };

    const states = Object.keys(stateZipMap);
    const randomState = states[Math.floor(Math.random() * states.length)];
    const zips = stateZipMap[randomState];
    const randomZip = zips[Math.floor(Math.random() * zips.length)];

    await page.getByLabel('Business Name *').fill(`Business-${randomString(6)}`);
    await page.getByLabel('Company Registration Number *').fill(randomDigits(8));
    await page.getByLabel('Address Line 1 *').fill('123 Main Street');
    await page.getByLabel('City/Town *').fill('Demo City');
    await page.getByRole('combobox', { name: 'State/Region' }).selectOption(randomState);
    await page.getByLabel('ZIP/Postal Code *').fill(randomZip);

    await saveAndNext(page, 'Seller Information');
  }

  // --- Primary Contact Information step ---
  if (currentStep === 'Primary Contact Information') {
    console.log('📝 Filling Seller Information / PCI step...');
    
    function randomPCIName() {
      const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
      const lastNames = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Lee'];
      return {
        first: firstNames[Math.floor(Math.random() * firstNames.length)],
        last: lastNames[Math.floor(Math.random() * lastNames.length)]
      };
    }
    const pci = randomPCIName();
    await page.getByRole('textbox', { name: 'First Name *' }).fill(pci.first);
    await page.getByRole('textbox', { name: 'Last Name *' }).fill(pci.last);

    await page.locator('#demo-simple-select').first().click();
    await page.getByRole('option').nth(2).click();

    await page.getByRole('textbox', { name: 'EIN/TIN' }).fill(randomDigits(9));

    const countries = ['Albania', 'Algeria', 'United States', 'Canada', 'Germany', 'France', 'India'];
    const randomCountry = countries[Math.floor(Math.random() * countries.length)];
    await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').first().click();
    await page.getByRole('option', { name: randomCountry }).click();

    function randomDOB() {
      const today = new Date();
      const latest = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
      const earliest = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate());
      return new Date(earliest.getTime() + Math.random() * (latest.getTime() - earliest.getTime()));
    }
    const dob = randomDOB();

    // Open DOB picker
await page.getByRole('button', { name: 'Choose date' }).first().click();

// Switch to year view
await page.locator('button.MuiPickersCalendarHeader-switchViewButton').click();

// Select the year
await page.getByText(String(dob.getFullYear()), { exact: true }).click({ force: true });
await page.locator('button.MuiPickersCalendarHeader-switchViewButton').click();

// Switch back to month/day view
await page.locator('button.MuiPickersCalendarHeader-switchViewButton').click();

// Select month
await page.getByRole('gridcell', { name: dob.toLocaleString('default', { month: 'long' }) }).first().click();

// Select day
await page.getByRole('gridcell', { name: String(dob.getDate()) }).first().click();


    await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

    function randomFutureDate(minDaysAhead = 7, maxYearsAhead = 5) {
      const today = new Date();
      const minDate = new Date(today.getTime() + minDaysAhead * 24 * 60 * 60 * 1000);
      const maxDate = new Date(today.getFullYear() + maxYearsAhead, today.getMonth(), today.getDate());
      return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
    }
    const expiry = randomFutureDate();
    await page.getByRole('button', { name: 'Choose date', exact: true }).click();
    await page.getByRole('option', { name: String(expiry.getFullYear()) }).click();
    await page.getByText(expiry.toLocaleString('default', { month: 'long' })).click();
    await page.getByRole('gridcell', { name: String(expiry.getDate()) }).first().click();

    await page.getByRole('textbox', { name: 'Mobile Number *' }).fill('1234567890');

    const stateZipMap = {
      Alaska: ['99501', '99502', '99503'],
      California: ['90001', '94105', '95814'],
      NewYork: ['10001', '11201', '14604'],
      Texas: ['73301', '75001', '77001'],
      Florida: ['33101', '32801', '32202']
    };
    const states = Object.keys(stateZipMap);
    const randomState = states[Math.floor(Math.random() * states.length)];
    const zips = stateZipMap[randomState];
    const randomZip = zips[Math.floor(Math.random() * zips.length)];

    await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business residential address 1');
    await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business residential address 2');
    await page.getByRole('textbox', { name: 'City/Town *' }).fill('Demo City');
    await page.getByRole('combobox', { name: 'State/Region' }).selectOption(randomState);
    await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill(randomZip);

    await saveAndNext(page, 'Billing');
  }

  // --- Billing step ---
  if (currentStep === 'Billing') {
    await page.getByRole('combobox', { name: 'Select Bank' }).click();
    await page.getByRole('option').nth(2).click();

    const accountNumber = randomDigits(Math.floor(Math.random() * 3) + 10);
    await page.getByRole('textbox', { name: 'Digit Routing Number *' }).fill('021000021');
    await page.getByRole('textbox', { name: 'Account Number *', exact: true }).fill(accountNumber);
    await page.getByRole('textbox', { name: 'Re-enter Bank Account Number *' }).fill(accountNumber);

    await saveAndNext(page, 'Store');
  }

  // --- Store & Verification steps can remain as is ---
});