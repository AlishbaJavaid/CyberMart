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
  'Maine': ['03901'],
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

// /// --- Save & Next helper (with retries + debug logs) ---
// async function saveAndNext(page, nextStepHeading) {
//   const saveBtn = page.getByRole('button', { name: /Continue|Save/i });
//   await expect(saveBtn).toBeEnabled({ timeout: 30000 });

//   const maxRetries = 3;
//   for (let attempt = 1; attempt <= maxRetries; attempt++) {
//     console.log(`🖱️ Clicking "Save and Next" (attempt ${attempt})...`);
//     await saveBtn.click({ force: true });

//     // wait a little before checking
//     await page.waitForTimeout(1500);

//     const currentStep = await detectStep(page);
//     console.log(`🔎 After click → Expected: ${nextStepHeading}, Detected: ${currentStep}`);

//     if (currentStep === nextStepHeading) {
//       console.log(`✅ Step advanced to ${nextStepHeading}`);
//       return;
//     }

//     console.log(`⚠️ Still on ${currentStep}, retrying...`);
//   }

//   throw new Error(`❌ Could not advance to step: ${nextStepHeading}`);
// }
/// --- Save & Next helper (with retries + OTP handling + debug logs) ---
async function saveAndNext(page, nextStepHeading, needsOTP = false) {
  const saveBtn = page.getByRole('button', { name: /Continue|Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 30000 });

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`🖱️ Clicking "Save and Next" (attempt ${attempt})...`);
    await saveBtn.click({ force: true });

    // Wait briefly for possible popup or navigation
    await page.waitForTimeout(1500);

    // --- Handle OTP if required ---
    if (needsOTP) {
      const otpBox = page.getByRole('textbox', { name: 'Enter OTP *' });
      if (await otpBox.isVisible()) {
        console.log(`🔐 OTP popup detected, entering code...`);
        await otpBox.fill('123456');
        await page.getByRole('button', { name: 'Verify' }).click();
        await expect(otpBox).toHaveCount(0, { timeout: 15000 });
        console.log(`✅ OTP verified successfully`);
      }
    }

    // --- Detect step after handling OTP ---
    const currentStep = await detectStep(page);
    console.log(`🔎 After click → Expected: ${nextStepHeading}, Detected: ${currentStep}`);

    if (currentStep === nextStepHeading) {
      console.log(`✅ Step advanced to ${nextStepHeading}`);
      return;
    }

    console.log(`⚠️ Still on ${currentStep}, retrying...`);
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
  // wait until at least one step heading is visible
  await page.getByRole('heading', { level: 6 }).first().waitFor({ timeout: 10000 });

  if (await page.getByRole('heading', { level: 6, name: /Account Type/i }).isVisible().catch(() => false)) {
    return 'Account Type';
  }
  if (await page.getByRole('heading', { level: 6, name: /Business Information/i }).isVisible().catch(() => false)) {
    return 'Business Information';
  }
  if (await page.getByRole('heading', { level: 6, name: /Primary Contact Information(\s*\(PCI\))?/i }).isVisible().catch(() => false)) {
    return 'Primary Contact Information';
  }
  if (await page.getByRole('heading', { level: 6, name: /Payment Information/i }).isVisible().catch(() => false)) {
  return 'Payment Information';
}
  if (await page.getByRole('heading', { level: 6, name: /Store/i }).isVisible().catch(() => false)) {
    return 'Store';
  }
  if (await page.getByRole('heading', { level: 6, name: /Verification/i }).isVisible().catch(() => false)) {
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
      await page.getByLabel('Business Name *').fill(`Business${randomString(6)}`);
      await page.getByLabel('Company Registration Number *').fill(randomDigits(7));
      await page.getByLabel('Address Line 1 *').fill('123 Main Street');
      await page.getByLabel('City/Town *').fill('Demo City');

      const statesBI = Object.keys(stateZipMap);
      const randomStateBI = statesBI[Math.floor(Math.random() * statesBI.length)];
      const zipsBI = stateZipMap[randomStateBI];
      const randomZipBI = zipsBI[Math.floor(Math.random() * zipsBI.length)];

      console.log(`🌍 Selected State: ${randomStateBI}, ZIP: ${randomZipBI}`);

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
      console.log('📝 Filling Seller Information (PCI) step...');
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

      // 🌍 Shared countries list
const countries = [
  'Albania', 'Algeria', 'Pakistan', 'Canada', 'Germany', 'France', 'India'
];
      // --- Country of Citizenship ---
const randomCitizenship = countries[Math.floor(Math.random() * countries.length)];
console.log(`🌍 Selected Country of Citizenship: ${randomCitizenship}`);

await page.locator('#demo-simple-select').first().click();
await page.getByRole('option', { name: randomCitizenship }).click();

      await page.getByRole('textbox', { name: 'EIN/TIN' }).fill(randomDigits(9));

      // --- Country of Birth ---
const randomBirth = countries[Math.floor(Math.random() * countries.length)];
console.log(`🌍 Selected Country of Birth: ${randomBirth}`);

await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').first().click();
await page.getByRole('option', { name: randomBirth }).click();

      function randomDOB() {
  const today = new Date();
  const latest = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const earliest = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate());
  return new Date(earliest.getTime() + Math.random() * (latest.getTime() - earliest.getTime()));
}

const dob = randomDOB();
console.log(`📅 Selected DOB: ${dob.toDateString()}`);

// 1. Open DOB calendar
await page.getByRole('button', { name: 'Choose date' }).first().click();

// 2. Open year view by clicking current month
const currentMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
await page.getByText(currentMonth).click();

// 3. Select year
await page.getByRole('radio', { name: String(dob.getFullYear()) }).click();

// 4. Navigate to target month
const targetMonth = dob.toLocaleString('default', { month: 'long' });

let visibleMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
while (!visibleMonth.includes(targetMonth)) {
  const visibleIndex = new Date(`${visibleMonth} 1`).getMonth();
  const targetIndex = dob.getMonth();

  if (visibleIndex > targetIndex) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  } else {
    await page.getByRole('button', { name: 'Next month' }).click();
  }

  // update after navigation
  visibleMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
}

// 5. Select day (scoped to the current visible month/year grid)
const calendar = page.getByRole('grid', { name: `${targetMonth} ${dob.getFullYear()}` });

// pick the day inside that grid only
await calendar.getByRole('gridcell', { name: String(dob.getDate()), exact: true }).first().click();


      await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

      // --- Country of Issue ---
const randomIssue = countries[Math.floor(Math.random() * countries.length)];
console.log(`🌍 Selected Country of Issue: ${randomIssue}`);

await page.locator('div:nth-child(7) > .MuiInputBase-root > #demo-simple-select').click();
await page.getByRole('option', { name: randomIssue }).click();

      // Generate random future expiry date (min 7 days ahead, up to 5 years)
function randomFutureDate(minDaysAhead = 7, maxYearsAhead = 5) {
  const today = new Date();
  const minDate = new Date(today.getTime() + minDaysAhead * 24 * 60 * 60 * 1000);
  const maxDate = new Date(today.getFullYear() + maxYearsAhead, today.getMonth(), today.getDate());
  return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
}

const expiry = randomFutureDate();
console.log(`📅 Selected Expiry Date: ${expiry.toDateString()}`);

// 1. Open expiry calendar
await page.getByRole('button', { name: 'Choose date', exact: true }).click();

// 2. Open year view
const expiryCurrentMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
await page.getByText(expiryCurrentMonth).click();

// 3. Select year
await page.getByRole('radio', { name: String(expiry.getFullYear()) }).click();

// 4. Navigate to target month
const expiryTargetMonth = expiry.toLocaleString('default', { month: 'long' });

let expiryVisibleMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
while (!expiryVisibleMonth.includes(expiryTargetMonth)) {
  const visibleIndex = new Date(`${expiryVisibleMonth} 1`).getMonth();
  const targetIndex = expiry.getMonth();

  if (visibleIndex > targetIndex) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  } else {
    await page.getByRole('button', { name: 'Next month' }).click();
  }

  expiryVisibleMonth = await page.locator('.MuiPickersCalendarHeader-label').first().innerText();
}

// 5. Select day (inside correct grid only)
const expiryCalendar = page.getByRole('grid', { name: `${expiryTargetMonth} ${expiry.getFullYear()}` });
await expiryCalendar.getByRole('gridcell', { name: String(expiry.getDate()), exact: true }).first().click();


function randomPhoneNumber() {
  // List of valid US area codes (you can expand this list as needed)
  const areaCodes = [252, 464, 541, 612, 707, 305, 415, 646, 714, 818];

  // Pick a random area code
  const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];

  // Generate remaining 7 digits
  let rest = '';
  for (let i = 0; i < 7; i++) {
    rest += Math.floor(Math.random() * 10);
  }

  return `${areaCode}${rest}`;
}

      await page.getByRole('textbox', { name: 'Mobile Number *' }).fill(randomPhoneNumber());

      await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business residential address 1');
      await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business residential address 2');
      await page.getByRole('textbox', { name: 'City/Town *' }).fill('Demo City');

      // --- PCI State + ZIP selection ---
// Pick a random state from stateZipMap
const statesPCI = Object.keys(stateZipMap);
const randomStatePCI = statesPCI[Math.floor(Math.random() * statesPCI.length)];

// Pick a ZIP that belongs to the chosen state
const zipsPCI = stateZipMap[randomStatePCI];
const randomZipPCI = zipsPCI[Math.floor(Math.random() * zipsPCI.length)];

console.log(`🌍 Selected PCI State: ${randomStatePCI}, ZIP: ${randomZipPCI}`);

// Locate State/Region
const stateDropdownPCI = page.locator('.space-y-3 > .grid > div:nth-child(4) > .MuiInputBase-root > #demo-simple-select');
// Open dropdown and select state option
await stateDropdownPCI.click();
const optionPCI = page.locator('li[role="option"]', { hasText: new RegExp(`^${randomStatePCI}$`) });
await expect(optionPCI).toBeVisible({ timeout: 5000 });
await optionPCI.click();

// Fill ZIP matching the selected state
await page.getByLabel('ZIP/Postal Code *').fill(randomZipPCI);


await saveAndNext(page, 'Payment Information', true);
      break;

    case 'Payment Information':
  console.log('💳 Filling Payment Information step...');
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
      '/account-management/account-type',
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
    // 👇 ADD THIS
if (page.url().includes('/sign-in')) {
  console.log('⚠️ Session expired, doing fresh login...');
  await context.close();
  ({ context, page } = await freshLogin(browser));
}
  }

  if (page.url().includes('/welcome')) {
  console.log('👀 Seller landed on Welcome page, waiting for auto-redirect...');
  await page.waitForLoadState('domcontentloaded');

  // Wait for either redirect to stepper OR fallback to sign-in
  await Promise.race([
    page.waitForURL('**/account-management/account-type/business/create-account?step=*', { timeout: 60000 }),
    page.waitForURL('**/sign-in', { timeout: 60000 })
  ]);

  if (page.url().includes('/sign-in')) {
    console.log('⚠️ Auto-redirect sent us back to sign-in, session is invalid.');
    await context.close();
    ({ context, page } = await freshLogin(browser));
  } else {
    console.log(`➡️ Auto-redirect completed: ${page.url()}`);
  }
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