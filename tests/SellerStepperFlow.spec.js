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

//npx cross-env SELLER=customSeller npx playwright test tests/sellerstepperflow.spec.js --headed
//run this command if want to use custom seller, it will take seller email and password from sellers.json file

test('Continue stepper flow with existing user', async ({ page }) => {
  test.slow(); // gives 3× timeout automatically
  await page.goto('https://qav2.cybermart.com/sign-in', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByTestId('emailOrPhone').fill(email);
  await page.getByTestId('password').fill(password);

  console.log(`🔑 Using seller: ${sellerType} (${email})`);

  console.log('⚠️ Please solve reCAPTCHA manually for signin...');
  await page.waitForFunction(() => {
    const el = document.querySelector('textarea[name="g-recaptcha-response"]');
    return el && el.value.length > 0;
  }, { timeout: 180000 });
  console.log('✅ reCAPTCHA solved.');

  await page.getByTestId('signin-submit').click();

// ✅ Conditional OTP verification
const otpField = page.getByRole('textbox', { name: 'Enter OTP *' });
if (await otpField.isVisible({ timeout: 5000 }).catch(() => false)) {
  console.log('📩 OTP required, entering code...');
  await otpField.fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: "Let's Start" }).click();
} else {
  console.log('✅ No OTP required, continuing flow...');
}

// ✅ Detect where the seller landed after signin
  const stepperSteps = [
    'Account Type',
    'Business Info',
    'Bank Info'
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

  // ✅ Handle each step dynamically
  if (currentStep === 'Account Type') {
    // Pause here → Playwright inspector opens, you manually select the option
    await page.waitForTimeout(60000); // let tester pick Own Business manually

    await expect(
      page.getByText('I confirm my account type are correct, and I understand that this information cannot be changed later.')
    ).toBeVisible();

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree and Continue' }).click();
  }

  if (currentStep === 'Business Info') {
    // Wait for Business Info step to be visible
  await expect(page.getByRole('heading', { name: 'Business Info' })).toBeVisible();
  // Business Info
  function randomBusinessName() {
  return `Business-${randomString(10)}`;
}
  await page.getByRole('textbox', { name: 'Business Name *' }).fill(randomBusinessName());
  await page.getByRole('textbox', { name: 'Company Registration Number *' }).fill(randomDigits(8));
  await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Registered business address 1');
  await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Registered business address 2');
  await page.getByRole('textbox', { name: 'City/Town *' }).fill('CO');
  await page.getByRole('combobox', { name: 'State/Region' }).first().click();
  await page.getByRole('option').nth(1).click(); // random pick
  await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill('06001');
  await page.getByRole('button', { name: 'Save and Next' }).click();

  function randomName() {
  return randomString(Math.floor(Math.random() * 10) + 3); // 3–12 chars
}
  // Personal Info
  await page.getByRole('textbox', { name: 'First Name *' }).fill(randomName());
  await page.getByRole('textbox', { name: 'Middle Name' }).fill(randomName());
  await page.getByRole('textbox', { name: 'Last Name *' }).fill(randomName());

  await page.locator('#demo-simple-select').first().click();
  await page.getByRole('option').nth(2).click(); // random country
  await page.getByRole('textbox', { name: 'EIN/TIN *' }).fill(randomDigits(Math.floor(Math.random() * 9) + 1));

  await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').click();
  await page.getByRole('option').nth(3).click();

  function randomDOB() {
  const today = new Date();
  const latestAllowed = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const earliestAllowed = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate());
  return new Date(
    earliestAllowed.getTime() +
      Math.random() * (latestAllowed.getTime() - earliestAllowed.getTime())
  );
}

const dob = randomDOB();
console.log(`📅 DOB chosen: ${dob.toDateString()}`);

// Open the datepicker
await page.getByRole('button', { name: 'Choose date' }).first().click();

// Open year picker
await page.getByRole('button', { name: /switch to year view/i }).click();

// Pick the correct year
await page.getByRole('option', { name: String(dob.getFullYear()) }).click();

// Pick the correct month
await page.getByRole('option', { name: dob.toLocaleString('default', { month: 'long' }) }).click();

// Pick the correct day
await page.getByRole('gridcell', { name: String(dob.getDate()) }).click();

  // Driving License
  await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

  function randomExpiryDate() {
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return new Date(
    minDate.getTime() +
      Math.random() * (365 * 24 * 60 * 60 * 1000) // within next year
  );
}

const expiry = randomExpiryDate();
console.log(`📅 Expiry chosen: ${expiry.toDateString()}`);

// Open datepicker
await page.getByRole('button', { name: 'Choose date', exact: true }).click();

// Navigate to correct year/month
await page.getByRole('button', { name: /switch to year view/i }).click();
await page.getByRole('option', { name: String(expiry.getFullYear()) }).click();
await page.getByRole('option', { name: expiry.toLocaleString('default', { month: 'long' }) }).click();

// Pick the correct day
await page.getByRole('gridcell', { name: String(expiry.getDate()) }).click();

// OR via datepicker
await page.getByRole('button', { name: 'Choose date', exact: true }).click();
await page.getByRole('gridcell', { name: String(expiry.getDate()) }).click();

function randomPhoneNumber() {
  const areaCodes = ['252', '305', '415', '646', '213'];
  const area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  let middle = Math.floor(Math.random() * 900 + 100).toString();
  let last = Math.floor(Math.random() * 9000 + 1000).toString(); // ensures not starting/ending 0
  return `${area} ${middle} ${last}`;
}
  // Phone number
  await page.getByRole('textbox', { name: 'Mobile Number *' }).fill(randomPhoneNumber());

  await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business residential address 1');
  await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business residential address 2');
  await page.getByRole('textbox', { name: 'City/Town *' }).fill('MA');
  await page.locator('.space-y-3 > .grid > div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill('03901');
  await page.getByRole('button', { name: 'Save and Next' }).click();

  await page.getByRole('textbox', { name: 'Enter OTP *' }).fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  }

  if (currentStep === 'Bank Info') {
    // Bank Info
  await page.getByRole('combobox', { name: 'Select Bank' }).click();
  await page.getByRole('option').nth(2).click();

  const accountNumber = randomDigits(Math.floor(Math.random() * 3) + 10); // 10–12 digits
  await page.getByRole('textbox', { name: 'Digit Routing Number *' }).fill('021000021');
  await page.getByRole('textbox', { name: 'Account Number *', exact: true }).fill(accountNumber);
  await page.getByRole('textbox', { name: 'Re-enter Bank Account Number *' }).fill(accountNumber);

  await page.getByRole('button', { name: 'Save and Next' }).click();
  }
  
});
