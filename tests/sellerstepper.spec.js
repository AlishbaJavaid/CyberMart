import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// --- Utils ---
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function randomDigits(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

// --- State/ZIP mapping (shared) ---
const stateZipMap = {
  'Alaska': ['99501', '99501', '99501'],
//   'California': ['90001', '94105', '95814'],
//   'New York': ['10001', '11201', '14604'],
//   'Texas': ['73301', '75001', '77001'],
//   'Florida': ['33101', '32801', '32202'],
};

// --- Auth & Seller Config ---
const authFile = `auth-${process.env.SELLER || 'default'}.json`;
const sellersPath = path.join(__dirname, 'sellers.json');
const sellers = JSON.parse(fs.readFileSync(sellersPath, 'utf8'));
const sellerType = process.env.SELLER || 'lastSignup';
const { email, password } = sellers[sellerType];

/// --- Save & Next helper (with retries) ---
async function saveAndNext(page, nextStepHeading) {
  const saveBtn = page.getByRole('button', { name: /Continue|Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 30000 });

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await saveBtn.click({ force: true });
    
    const currentStep = await detectStep(page);
    
    if (currentStep === nextStepHeading) {
      console.log(`✅ Step advanced to ${nextStepHeading}`);
      return;
    }

    console.log(`⚠️ Attempt ${attempt}: still on ${currentStep}, retrying...`);
    await page.waitForTimeout(1000); // wait a bit before retry
  }

  throw new Error(`❌ Could not advance to step: ${nextStepHeading}`);
}

// --- Fresh login flow ---
async function freshLogin(browser) {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();

  await pg.goto('https://qav2.cybermart.com/sign-in', {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });

  await expect(pg.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  console.log('⚠️ Solve reCAPTCHA manually...');
  await expect(pg.locator('textarea[name="g-recaptcha-response"]')).toHaveValue(/.+/, {
    timeout: 180000,
  });
  console.log('✅ reCAPTCHA solved.');

  await pg.getByTestId('emailOrPhone').fill(email);
  await pg.getByTestId('password').fill(password);
  await pg.getByRole('button', { name: 'Continue' }).click();

  // Handle OTP if shown
  const otpField = pg.getByRole('textbox', { name: 'Enter OTP *' });
  if (await otpField.isVisible().catch(() => false)) {
    console.log('📩 OTP required, entering code...');
    await otpField.fill('123456');
    await pg.getByRole('button', { name: 'Verify' }).click();
  }

  // Wait until logged in
  await pg.waitForURL(/(welcome|account-management|dashboard|stepper)/, { timeout: 60000 });

  // Save final session after login
  await ctx.storageState({ path: authFile });
  console.log(`✅ Final auth saved to ${authFile}`);

  return { context: ctx, page: pg };
}

// --- Step detection ---
async function detectStep(page) {
  if (await page.getByRole('heading', { level: 6, hasText: /Account Type/i }).isVisible().catch(() => false)) {
    return 'Account Type';
  }
  if (await page.getByRole('heading', { level: 6, hasText: /Business Information/i }).isVisible().catch(() => false)) {
    return 'Business Information';
  }
  if (await page.getByRole('heading', { level: 6, hasText: /Primary Contact Information/i }).isVisible().catch(() => false)) {
    return 'Primary Contact Information';
  }
  if (await page.getByRole('heading', { level: 6, hasText: /Billing/i }).isVisible().catch(() => false)) {
    return 'Billing';
  }
  if (await page.getByRole('heading', { level: 6, hasText: /Store/i }).isVisible().catch(() => false)) {
    return 'Store';
  }
  if (await page.getByRole('heading', { level: 6, hasText: /Verification/i }).isVisible().catch(() => false)) {
    return 'Verification';
  }

  // Fallback: check URL
  const stepperUrls = [
    '/account-management/welcome',
    '/account-management/account-type',
    '/account-management/account-type/business/create-account?step=0',
    '/account-management/account-type/business/create-account?step=1',
    '/account-management/account-type/business/create-account?step=2',
    '/account-management/account-type/business/create-account?step=3',
    '/account-management/account-type/business/create-account?step=4',
  ];

  if (stepperUrls.some(url => page.url().includes(url))) {
    console.log(`⚠️ On stepper URL but heading not matched: ${page.url()}`);
    return 'unknown-step';
  }

  if (page.url().includes('/dashboard')) {
    console.log('✅ Seller already completed stepper, now on dashboard.');
    return null;
  }

  return 'unknown-step';
}

// --- Step handlers ---
async function handleStep(page, step) {
  switch (step) {
    case 'Account Type':
      console.log('⚙️ Handling Account Type step...');
      await page.locator('div').filter({ hasText: /^PrivatelyOwn Business$/ }).first().click();
      await expect(page.getByText('Business Account')).toBeVisible();
      await expect(page.getByText('I confirm my account type are correct...')).toBeVisible();
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Agree and Continue' }).click();
      break;

    case 'Business Information':
      console.log('📝 Filling Business Information step...');

      const statesBI = Object.keys(stateZipMap);
      const randomStateBI = statesBI[Math.floor(Math.random() * statesBI.length)];
      const zipsBI = stateZipMap[randomStateBI];
      const randomZipBI = zipsBI[Math.floor(Math.random() * zipsBI.length)];

      console.log(`🌍 Selected State: ${randomStateBI}, ZIP: ${randomZipBI}`);

      await page.getByLabel('Business Name *').fill(`Business${randomString(6)}`);
      await page.getByLabel('Company Registration Number *').fill(randomDigits(7));
      await page.getByLabel('Address Line 1 *').fill('123 Main Street');
      await page.getByLabel('City/Town *').fill('Demo City');

      // Locate enabled State/Region combobox
      const stateDropdown = page.locator('div[role="combobox"]:not([aria-disabled="true"])');

      await stateDropdown.click();
      const option = page.locator('li[role="option"]', { hasText: randomStateBI });
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();

      await page.getByLabel('ZIP/Postal Code *').fill(randomZipBI);
      await saveAndNext(page, 'Primary Contact Information');
      break;

    case 'Primary Contact Information':
      console.log('📝 Filling PCI step...');
      function randomPCIName() {
        const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
        const lastNames = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Lee'];
        const first = firstNames[Math.floor(Math.random() * firstNames.length)];
        const last = lastNames[Math.floor(Math.random() * lastNames.length)];
        return { first, last };
      }

      const pci = randomPCIName();

      await page.getByRole('textbox', { name: 'First Name *' }).fill(pci.first);
      await page.getByRole('textbox', { name: 'Last Name *' }).fill(pci.last);
      console.log(`📌 PCI Name filled: ${pci.first} ${pci.last}`);

      await page.locator('#demo-simple-select').first().click();
      await page.getByRole('option').nth(2).click();

      await page.getByRole('textbox', { name: 'EIN/TIN' }).fill(randomDigits(9));

      const countries = [
        'Albania', 'Algeria', 'United States', 'Canada', 'Germany', 'France', 'India'
      ];

      const randomCountry = countries[Math.floor(Math.random() * countries.length)];
      console.log(`🌍 Selected Country of Birth: ${randomCountry}`);

      await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').first().click();
      await page.getByRole('option', { name: randomCountry }).click();

      function randomDOB() {
        const today = new Date();
        const latest = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
        const earliest = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate());
        return new Date(earliest.getTime() + Math.random() * (latest.getTime() - earliest.getTime()));
      }

      const dob = randomDOB();
      console.log(`📅 Selected DOB: ${dob.toDateString()}`);

      await page.getByRole('button', { name: 'Choose date' }).first().click();
      await page.locator('button.MuiPickersCalendarHeader-switchViewButton').click();

      let currentYear = parseInt(await page.locator('button.MuiPickersYear-root.Mui-selected').textContent());

      while (currentYear !== dob.getFullYear()) {
        if (currentYear > dob.getFullYear()) {
          await page.getByRole('button', { name: 'Previous year' }).click();
        } else {
          await page.getByRole('button', { name: 'Next year' }).click();
        }
        currentYear = parseInt(await page.locator('button.MuiPickersYear-root.Mui-selected').textContent());
      }

      await page.getByRole('option', { name: dob.toLocaleString('default', { month: 'long' }) }).click();
      await page.getByRole('gridcell', { name: String(dob.getDate()) }).click();

      await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

      function randomFutureDate(minDaysAhead = 7, maxYearsAhead = 5) {
        const today = new Date();
        const minDate = new Date(today.getTime() + minDaysAhead * 24 * 60 * 60 * 1000);
        const maxDate = new Date(today.getFullYear() + maxYearsAhead, today.getMonth(), today.getDate());
        return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
      }

      const expiry = randomFutureDate();
      console.log(`📅 Selected Expiry Date: ${expiry.toDateString()}`);

      await page.getByRole('button', { name: 'Choose date', exact: true }).click();
      await page.getByRole('option', { name: String(expiry.getFullYear()) }).click();
      await page.getByText(expiry.toLocaleString('default', { month: 'long' })).click();
      await page.getByRole('gridcell', { name: String(expiry.getDate()) }).first().click();

      await page.getByRole('textbox', { name: 'Mobile Number *' }).fill(randomPhoneNumber());

      // Reuse shared stateZipMap
      const statesPCI = Object.keys(stateZipMap);
      const randomStatePCI = statesPCI[Math.floor(Math.random() * statesPCI.length)];
      const zipsPCI = stateZipMap[randomStatePCI];
      const randomZipPCI = zipsPCI[Math.floor(Math.random() * zipsPCI.length)];

      console.log(`🌍 Selected PCI State: ${randomStatePCI}, ZIP: ${randomZipPCI}`);

      await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business residential address 1');
      await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business residential address 2');
      await page.getByRole('textbox', { name: 'City/Town *' }).fill('Demo City');

      await page.getByRole('combobox', { name: 'State/Region' }).selectOption(randomStatePCI);
      await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill(randomZipPCI);

      await saveAndNext(page, 'Billing');
      break;

    case 'Billing':
      console.log('🏦 Filling Billing step...');
      await saveAndNext(page, 'Store');
      break;

    case 'Store':
      console.log('🏬 Store step...');
      await page.getByRole('combobox', { name: 'Select Bank' }).click();
      await page.getByRole('option').nth(2).click();

      const accountNumber = randomDigits(Math.floor(Math.random() * 3) + 10);
      await page.getByRole('textbox', { name: 'Digit Routing Number *' }).fill('021000021');
      await page.getByRole('textbox', { name: 'Account Number *', exact: true }).fill(accountNumber);
      await page.getByRole('textbox', { name: 'Re-enter Bank Account Number *' }).fill(accountNumber);

      await saveAndNext(page, 'Verification');
      break;
  }
  return true;
}

// --- Main Test ---
test('Continue stepper flow with existing user (with auto-auth)', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  test.slow();

  let context;
  let page;

  if (!fs.existsSync(authFile)) {
    ({ context, page } = await freshLogin(browser));
  } else {
    context = await browser.newContext({ storageState: authFile });
    page = await context.newPage();

    const cookies = (await context.cookies()).map(c => `${c.name}=${c.value}; Domain=${c.domain}`);
    console.log('🔎 Loaded cookies:', cookies);

    const possibleSteps = [
      '/account-management/welcome',
      '/account-management/account-type/business/create-account?step=0',
      '/account-management/account-type/business/create-account?step=1',
      '/account-management/account-type/business/create-account?step=2',
      '/account-management/account-type/business/create-account?step=3',
      '/account-management/account-type/business/create-account?step=4',
    ];

    let navigated = false;
    for (const stepUrl of possibleSteps) {
      try {
        await page.goto(`https://qav2.cybermart.com${stepUrl}`, { waitUntil: 'domcontentloaded' });
        if (await page.getByRole('heading').first().isVisible({ timeout: 2000 })) {
          console.log(`➡️ Seller on stepper page: ${page.url()}`);
          navigated = true;
          break;
        }
      } catch {}
    }

    if (!navigated) {
      console.log('⚠️ Could not navigate to stepper, maybe already completed.');
    }
  }

  if (page.url().includes('/welcome')) {
    console.log('👀 Seller landed on Welcome page, waiting for auto-redirect...');
    await page.waitForURL('**/account-management/account-type/business/create-account?step=*', {
      timeout: 60000
    });
    console.log(`➡️ Auto-redirect completed: ${page.url()}`);
  }

  let keepGoing = true;
  while (keepGoing) {
    const step = await detectStep(page);

    if (step === null) break;
    if (step === 'unknown-step')
      throw new Error(`⚠️ Unknown step detected at URL: ${page.url()}`);

    console.log(`📌 Current step: ${step}`);
    keepGoing = await handleStep(page, step);
  }
});