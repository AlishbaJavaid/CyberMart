import { test, expect } from '@playwright/test';
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

// --- Helper for safe "Save and Next" navigation ---
async function saveAndNext(page, nextStepHeading) {
  const saveBtn = page.getByRole('button', { name: 'Save and Next' });

  // Wait until visible and enabled
  await expect(saveBtn).toBeVisible({ timeout: 30000 });
  await expect(saveBtn).toBeEnabled({ timeout: 30000 });

  // Click with retry if intercepted
  await saveBtn.click({ force: true });

  // Wait for either next step heading or URL change
  if (nextStepHeading) {
    await expect(
      page.getByRole('heading', { name: nextStepHeading })
    ).toBeVisible({ timeout: 60000 });
  } else {
    await page.waitForURL(/stepper|dashboard/, { timeout: 60000 });
  }
}

// Run: npx cross-env SELLER=customSeller npx playwright test tests/sellerstepperflow.spec.js --headed
test('Continue stepper flow with existing user', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000); // allow up to 5 min for slow staging
  test.slow(); // gives 3× timeout automatically

  await page.goto('https://qav2.cybermart.com/sign-in', {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('emailOrPhone')).toBeVisible();
  await expect(page.getByTestId('password')).toBeVisible();

  // --- Wait for manual reCAPTCHA solve ---
  console.log('⚠️ Solve reCAPTCHA manually...');
  await expect(page.locator('textarea[name="g-recaptcha-response"]'))
    .toHaveValue(/.+/, { timeout: 180000 });
  console.log('✅ reCAPTCHA solved.');

  // --- Now wait for fields to unlock after captcha ---
  const emailField = page.getByTestId('emailOrPhone');
  const passwordField = page.getByTestId('password');

  await expect(emailField).toBeVisible();
  await expect(emailField).toBeEnabled();
  await expect(passwordField).toBeVisible();
  await expect(passwordField).toBeEnabled();

  // --- Fill credentials ---
  await emailField.fill(email);
  await passwordField.fill(password);
  console.log(`🔑 Using seller: ${sellerType} (${email})`);

  // --- Click Continue ---
  await page.getByRole('button', { name: 'Continue' }).click();

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

  // --- Handle Welcome page if shown ---
  if (page.url().includes('/welcome')) {
    console.log('👋 Seller landed on Welcome page (no Account Type yet)');
    await page.getByRole('button', { name: "Let's Start" }).click();

    // After clicking, seller should go to stepper (Account Type)
    await page.waitForURL(/stepper/, { timeout: 60000 });
    console.log(`➡️ Redirected to stepper: ${page.url()}`);
  }

  // ✅ Detect where the seller landed after signin
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

  // --- Handle Account Type step automatically ---
  if (currentStep === 'Account Type') {
    console.log('⚙️ Handling Account Type step...');

    // Select Privately Own Business
    await page.locator('div')
      .filter({ hasText: /^PrivatelyOwn Business$/ })
      .first()
      .click();

    await expect(
      page.getByText('Business Account')
    ).toBeVisible();

    await expect(
      page.getByText('I confirm my account type are correct, and I understand that this information cannot be changed later.')
    ).toBeVisible();

    // Agree and continue
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree and Continue' }).click();

    console.log('✅ Account Type step completed, moving forward...');
  }

  // --- Handle Business Information step ---
  if (currentStep === 'Business Information') {
    console.log('📝 Filling Business Information step...');

    await expect(page.getByRole('heading', { name: 'Business Information' })).toBeVisible();

    // --- State → ZIP mapping (extend as needed) ---
    const stateZipMap = {
      Alaska: ['99501', '99502', '99503'],
      California: ['90001', '94105', '95814'],
      NewYork: ['10001', '11201', '14604'],
      Texas: ['73301', '75001', '77001'],
      Florida: ['33101', '32801', '32202']
    };

    // Pick a random state
    const states = Object.keys(stateZipMap);
    const randomState = states[Math.floor(Math.random() * states.length)];

    // Pick a matching ZIP for that state
    const zips = stateZipMap[randomState];
    const randomZip = zips[Math.floor(Math.random() * zips.length)];

    console.log(`🌍 Selected State: ${randomState}, ZIP: ${randomZip}`);

    // --- Fill in Business Information ---
    await page.getByLabel('Business Name *').fill(`Business-${randomString(6)}`);
    await page.getByLabel('Company Registration Number *').fill(randomDigits(7));
    await page.getByLabel('Address Line 1 *').fill('123 Main Street');
    await page.getByLabel('City/Town *').fill('Demo City');

    // Select state
    await page.getByRole('combobox', { name: 'State/Region' }).selectOption(randomState);

    // Fill matching ZIP
    await page.getByLabel('ZIP/Postal Code *').fill(randomZip);

    // Continue
    await saveAndNext(page, 'Seller Information');
  }

 // --- Handle Seller Information / Primary Contact Information (PCI) ---
if (currentStep === 'Primary Contact Information') {
  console.log('📝 Filling Seller Information / PCI step...');

  // Random PCI name
  function randomPCIName() {
    const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Lee'];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return { first, last };
  }

  const pci = randomPCIName();

  // Fill Primary Contact Information fields
  await page.getByRole('textbox', { name: 'First Name *' }).fill(pci.first);
  await page.getByRole('textbox', { name: 'Last Name *' }).fill(pci.last);
  console.log(`📌 PCI Name filled: ${pci.first} ${pci.last}`);

  // Country selection (example)
  await page.locator('#demo-simple-select').first().click();
  await page.getByRole('option').nth(2).click();

  // EIN/TIN
  await page.getByRole('textbox', { name: 'EIN/TIN' }).fill(randomDigits(9));

  // --- Select Country of Birth randomly ---
const countries = [
  'Albania', 'Algeria', 'United States', 'Canada', 'Germany', 'France', 'India'
  // add more as needed
];

// Pick a random country
const randomCountry = countries[Math.floor(Math.random() * countries.length)];
console.log(`🌍 Selected Country of Birth: ${randomCountry}`);

// Open the dropdown
  await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').first().click();

// Select the random country
await page.getByRole('option', { name: randomCountry }).click();

// Helper: random date of birth (18–80)
function randomDOB() {
  const today = new Date();
  const latest = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const earliest = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate());
  return new Date(earliest.getTime() + Math.random() * (latest.getTime() - earliest.getTime()));
}

const dob = randomDOB();
console.log(`📅 Selected DOB: ${dob.toDateString()}`);

// Open DOB picker
await page.getByRole('button', { name: 'Choose date' }).first().click();

// Open year view
await page.locator('button.MuiPickersCalendarHeader-switchViewButton').click();

// Scroll to target year
let currentYear = await page.locator('button.MuiPickersYear-root.Mui-selected').textContent();
currentYear = parseInt(currentYear);

while (currentYear !== dob.getFullYear()) {
  if (currentYear > dob.getFullYear()) {
    await page.getByRole('button', { name: 'Previous year' }).click();
  } else {
    await page.getByRole('button', { name: 'Next year' }).click();
  }
  currentYear = parseInt(await page.locator('button.MuiPickersYear-root.Mui-selected').textContent());
}

// Select month and day
await page.getByRole('option', { name: dob.toLocaleString('default', { month: 'long' }) }).click();
await page.getByRole('gridcell', { name: String(dob.getDate()) }).click();

  // Driving License
  await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

  // --- Expiry Date (random future date) ---
function randomFutureDate(minDaysAhead = 7, maxYearsAhead = 5) {
  const today = new Date();
  const minDate = new Date(today.getTime() + minDaysAhead * 24 * 60 * 60 * 1000); // at least minDaysAhead days later
  const maxDate = new Date(today.getFullYear() + maxYearsAhead, today.getMonth(), today.getDate());
  return new Date(
    minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime())
  );
}

const expiry = randomFutureDate(); 
console.log(`📅 Selected Expiry Date: ${expiry.toDateString()}`);

// Open Expiry Date picker
await page.getByRole('button', { name: 'Choose date', exact: true }).click();

// Select year
await page.getByRole('option', { name: String(expiry.getFullYear()) }).click();

// Select month
await page.getByText(expiry.toLocaleString('default', { month: 'long' })).click();

// Select day
await page.getByRole('gridcell', { name: String(expiry.getDate()) }).first().click();

  // Mobile Number
  await page.getByRole('textbox', { name: 'Mobile Number *' }).fill(randomPhoneNumber());

  // --- Reuse stateZipMap from Business Info ---
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

  console.log(`🌍 Selected PCI State: ${randomState}, ZIP: ${randomZip}`);

  // Fill PCI address
  await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business residential address 1');
  await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business residential address 2');
  await page.getByRole('textbox', { name: 'City/Town *' }).fill('Demo City');

  // Select State/Region
  await page.getByRole('combobox', { name: 'State/Region' }).selectOption(randomState);

  // Fill matching ZIP
  await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill(randomZip);

  // Continue to next step
  await saveAndNext(page, 'Billing');
}

  // --- Handle Billing step ---
  if (currentStep === 'Billing') {
    // Bank Info
    await page.getByRole('combobox', { name: 'Select Bank' }).click();
    await page.getByRole('option').nth(2).click();

    const accountNumber = randomDigits(Math.floor(Math.random() * 3) + 10); // 10–12 digits
    await page.getByRole('textbox', { name: 'Digit Routing Number *' }).fill('021000021');
    await page.getByRole('textbox', { name: 'Account Number *', exact: true }).fill(accountNumber);
    await page.getByRole('textbox', { name: 'Re-enter Bank Account Number *' }).fill(accountNumber);

    await saveAndNext(page, 'Store');
  }

  // if (currentStep === 'Store') {
  //        ///store step
  // }

  // if (currentStep === 'Verification') {
  //     ////verification step
  // }

});
