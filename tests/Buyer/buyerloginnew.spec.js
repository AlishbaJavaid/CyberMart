import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const STORAGE_FILE = 'buyer-session.json';
const BUYER_URL = 'https://qabuyer.cybermart.com/';
const PROFILE_API = 'https://qaapi.cybermart.com/api/v1/user/profile/get-profile';
const DEFAULT_LOCATION = { latitude: 24.8607, longitude: 67.0011, accuracy: 100 };

test('buyer login with saved session and location', async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    geolocation: DEFAULT_LOCATION,
    permissions: ['geolocation'],
    storageState: fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : undefined,
  });

  const page = await context.newPage();

  console.log('🔹 Buyer session file exists:', fs.existsSync(STORAGE_FILE));

  // Inject mock location into localStorage before any navigation
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

  // Navigate to buyer URL
  await page.goto(BUYER_URL, { waitUntil: 'domcontentloaded' });

  // Wait until main content or header is visible
  await page.locator('header, main, #app').first().waitFor({ state: 'visible', timeout: 20000 });

  // Log cookies (skip large localStorage log)
  const cookies = await context.cookies();
  console.log('🔹 Current cookies:', cookies);

  // Detect if buyer is logged in
  const isLoggedIn = await page.evaluate(() => !!localStorage.getItem('userProfileData'));
  console.log('🔹 Is buyer already logged in?', isLoggedIn);

  if (!isLoggedIn) {
    console.log('🔹 Logging in buyer manually...');
    const loginParagraph = page.getByRole('paragraph').filter({ hasText: 'Login / Register' });
    await loginParagraph.click();

    const emailInput = page.getByRole('textbox', { name: 'Phone/Email *' });
    // Try clicking up to 4 times until email input is visible
    for (let attempt = 1; attempt <= 4; attempt++) {
      await loginParagraph.click();
      try {
        await expect(emailInput).toBeVisible({ timeout: 5000 });
        break; // success
      } catch {
        if (attempt === 4) throw new Error('Login modal did not appear after 3 attempts');
        console.log(`⚠️ Attempt ${attempt} failed, retrying...`);
      }
    }
    await emailInput.fill('alishba+11@cybermart.com');

    const continueButton = page.getByRole('button', { name: 'Continue' });
    // Try clicking up to 4 times until password input is visible
    for (let attempt = 1; attempt <= 4; attempt++) {
      await continueButton.click();
      try {
        const passwordInput = page.getByTestId('password');
        await expect(passwordInput).toBeVisible({ timeout: 5000 });
        break; // success
      } catch {
        if (attempt === 4) throw new Error('Continue button did not proceed after 3 attempts');
        console.log(`⚠️ Attempt ${attempt} to click Continue failed, retrying...`);
      }
    }

    const passwordInput = page.getByTestId('password');
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    await passwordInput.fill('Alishba@321');

    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for profile API after manual login
    await page.waitForResponse(response =>
      response.url() === PROFILE_API && response.status() === 200,
      { timeout: 20000 }
    );

    await page.waitForTimeout(2000);
    console.log('✅ Manual login completed');
  } else {
    // Optional: wait for profile API if already logged in
    await page.waitForResponse(response =>
      response.url() === PROFILE_API && response.status() === 200,
      { timeout: 20000 }
    );
  }

  // Save session, cookies, localStorage, and geolocation
  const finalCookies = await context.cookies();
  const finalLocalStorage = await page.evaluate(() => ({ ...localStorage }));

  fs.writeFileSync(
    STORAGE_FILE,
    JSON.stringify(
      {
        cookies: finalCookies,
        localStorage: finalLocalStorage,
        location: DEFAULT_LOCATION,
      },
      null,
      2
    )
  );

  // console.log('💾 Session, cookies, localStorage, and location saved');
  await browser.close();
});
