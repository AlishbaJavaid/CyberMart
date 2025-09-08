import { test, expect } from '@playwright/test';

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

function randomBusinessName() {
  return `Business-${randomString(10)}`;
}

function randomName() {
  return randomString(Math.floor(Math.random() * 10) + 3); // 3–12 chars
}

function randomDOB() {
  const today = new Date();
  const latestAllowed = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const earliestAllowed = new Date(today.getFullYear() - 80, today.getMonth(), today.getDate()); // assume max 80 years old
  const dob = new Date(earliestAllowed.getTime() + Math.random() * (latestAllowed.getTime() - earliestAllowed.getTime()));
  return dob;
}

function randomExpiryDate() {
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const expiry = new Date(minDate.getTime() + Math.random() * (365 * 24 * 60 * 60 * 1000)); // within next year
  return expiry;
}

function randomPhoneNumber() {
  const areaCodes = ['252', '305', '415', '646', '213'];
  const area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  let middle = Math.floor(Math.random() * 900 + 100).toString();
  let last = Math.floor(Math.random() * 9000 + 1000).toString(); // ensures not starting/ending 0
  return `${area} ${middle} ${last}`;
}

test('Business account signup flow', async ({ page }) => {
    // Increase overall test timeout to e.g. 3 minutes
    test.setTimeout(180000);

    await page.goto('https://qav2.cybermart.com/sign-up', {
    waitUntil: 'domcontentloaded',
    timeout: 60000, // allow up to 60s for slower test envs
  });

  // Assert sign-up form is visible before proceeding
  await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible();

  // Wait for reCAPTCHA iframe to be present
  await page.frameLocator('iframe[title="reCAPTCHA"]').locator('span#recaptcha-anchor').waitFor();
  // email with random suffix
  const email = randomEmail();
  await page.getByTestId('emailOrPhone').fill(email);

  await page.getByTestId('password').fill('Alishba@123');
  await page.getByTestId('confirmPassword').fill('Alishba@123');

// ReCAPTCHA (manual)
console.log('⚠️ Please solve the reCAPTCHA manually...');

// Wait until reCAPTCHA response is filled
await page.waitForFunction(() => {
  const el = document.querySelector('textarea[name="g-recaptcha-response"]');
  return el && el.value.length > 0;
}, { timeout: 180000 }); // wait up to 3 minutes

console.log('✅ reCAPTCHA solved, continuing...');

await page.getByTestId('signup-submit').click();

  // OTP verification
  await page.getByRole('textbox', { name: 'Enter OTP *' }).fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: "Let's Start" }).click();

  // Confirm account type section is visible
await expect(page.getByRole('heading', { name: 'Account Type' })).toBeVisible();
// const ownBusinessCard = page.locator('text=Own Business').first();
// await ownBusinessCard.click();
// Pause here → Playwright inspector opens, you manually select the option

// wait up to 60s so you can manually select Own Business in the browser
await page.waitForTimeout(60000);
await expect(
  page.getByText('I confirm my account type are correct, and I understand that this information cannot be changed later.')
).toBeVisible();
// Confirm and continue
await page.getByRole('checkbox').check();
await page.getByRole('button', { name: 'Agree and Continue' }).click();

  // Wait for Business Info step to be visible
  await expect(page.getByRole('heading', { name: 'Business Info' })).toBeVisible();
  // Business Info
  await page.getByRole('textbox', { name: 'Business Name *' }).fill(randomBusinessName());
  await page.getByRole('textbox', { name: 'Company Registration Number *' }).fill(randomDigits(8));
  await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Registered business address 1');
  await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Registered business address 2');
  await page.getByRole('textbox', { name: 'City/Town *' }).fill('CO');
  await page.getByRole('combobox', { name: 'State/Region' }).first().click();
  await page.getByRole('option').nth(1).click(); // random pick
  await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill('06001');
  await page.getByRole('button', { name: 'Save and Next' }).click();

  // Personal Info
  await page.getByRole('textbox', { name: 'First Name *' }).fill(randomName());
  await page.getByRole('textbox', { name: 'Middle Name' }).fill(randomName());
  await page.getByRole('textbox', { name: 'Last Name *' }).fill(randomName());

  await page.locator('#demo-simple-select').first().click();
  await page.getByRole('option').nth(2).click(); // random country
  await page.getByRole('textbox', { name: 'EIN/TIN *' }).fill(randomDigits(Math.floor(Math.random() * 9) + 1));

  await page.locator('div:nth-child(4) > .MuiInputBase-root > #demo-simple-select').click();
  await page.getByRole('option').nth(3).click();

  // DOB (≥18 years)
  const dob = randomDOB();
  console.log(`DOB chosen: ${dob.toDateString()}`);
  await page.getByRole('button', { name: 'Choose date' }).first().click();
  // here you'd need logic to navigate the datepicker to dob

  // Driving License
  await page.getByRole('textbox', { name: 'Driving License *' }).fill('DL' + randomString(6));

  // Expiry date ≥7 days later
  const expiry = randomExpiryDate();
  console.log(`Expiry chosen: ${expiry.toDateString()}`);
  await page.getByRole('button', { name: 'Choose date', exact: true }).click();
  // here also navigate picker to expiry date

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

  // Bank Info
  await page.getByRole('combobox', { name: 'Select Bank' }).click();
  await page.getByRole('option').nth(2).click();

  const accountNumber = randomDigits(Math.floor(Math.random() * 3) + 10); // 10–12 digits
  await page.getByRole('textbox', { name: '-Digit Routing Number *' }).fill('021000021');
  await page.getByRole('textbox', { name: 'Account Number *', exact: true }).fill(accountNumber);
  await page.getByRole('textbox', { name: 'Re-enter Bank Account Number *' }).fill(accountNumber);

  await page.getByRole('button', { name: 'Save and Next' }).click();
});
