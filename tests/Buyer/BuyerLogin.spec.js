import { test, expect } from '@playwright/test';
import fs from 'fs';

const STORAGE_FILE = 'buyer-session.json';

test('buyer login with saved session', async ({ page }) => {
  // Reuse session if available
  if (fs.existsSync(STORAGE_FILE)) {
    await page.context().addCookies([]); // ensure no conflict
    await page.context().storageState({ path: STORAGE_FILE });
  }

  // Always inject mock location before navigation
  await page.addInitScript(() => {
    localStorage.setItem(
      'user-location-storage',
      JSON.stringify({
        state: {
          coords: { lat: 24.8607, lng: 67.0011 }, // Karachi
          locationStateName: "Sindh",
          locationCountryName: "Pakistan"
        }
      })
    );
  });

await page.goto('https://qabuyer.cybermart.com/', { waitUntil: 'domcontentloaded' });

  // Check if already logged in (Login/Register replaced by buyer’s name)
  const isLoggedIn = await page.getByRole('paragraph').filter({ hasText: 'Login / Register' }).count() === 0;

if (!isLoggedIn) {
  const loginParagraph = page.getByRole('paragraph').filter({ hasText: 'Login / Register' });
  const emailInput = page.getByRole('textbox', { name: 'Phone/Email *' });

  // Try clicking up to 3 times until email input is visible
  for (let attempt = 1; attempt <= 4; attempt++) {
    await loginParagraph.click();
    try {
      await expect(emailInput).toBeVisible({ timeout: 5000 });
      break; // success, exit loop
    } catch {
      if (attempt === 4) throw new Error('Login modal did not appear after 3 attempts');
      console.log(`⚠️ Attempt ${attempt} failed, retrying...`);
    }
  }
  // Fill email
  await emailInput.fill('alishba+11@cybermart.com');

  const continueButton = page.getByRole('button', { name: 'Continue' });

// Try clicking up to 3 times until next element (password field) is visible
for (let attempt = 1; attempt <= 4; attempt++) {
  await continueButton.click();
  try {
    // Wait for password input to appear as indication that click worked
    const passwordInput = page.getByTestId('password');
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    break; // success, exit loop
  } catch {
    if (attempt === 4) throw new Error('Continue button did not proceed after 3 attempts');
    console.log(`⚠️ Attempt ${attempt} to click Continue failed, retrying...`);
  }
}

  // ✅ Wait until password field is visible before filling
  const passwordInput = page.getByTestId('password');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill('Alishba@321');

  await page.getByRole('button', { name: 'Sign In' }).click();

  // Save new session
  await page.context().storageState({ path: STORAGE_FILE });
}


  // Target only the header paragraph that might contain Login/Register
const loginParagraph = page.getByRole('paragraph').filter({ hasText: 'Login / Register' });

// Assert that this specific element is not visible
await expect(loginParagraph).toHaveCount(0);

});
