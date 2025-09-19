import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const imagePath = (filename) => path.join(__dirname, '../test-data/Images', filename);

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
  "Delaware": ["19701", "19980"],
  "Alaska": ["99501", "99950"],
  "Maryland": ["20601", "21930"],
  "New Hampshire": ["03031", "03897"],
  "Kansas": ["66002", "67954"],
  "Texas": ["75001", "88595"],
  "Nebraska": ["68001", "69367"],
  "Vermont": ["05001", "05495"],
  "Hawaii": ["96701", "96898"],
  "Guam": ["96910", "96932"],
  "Utah": ["84001", "84791"],
  "Oregon": ["97001", "97920"],
  "California": ["90001", "96162"],
  "New Jersey": ["07001", "08989"],
  "North Dakota": ["58001", "58856"],
  "Kentucky": ["40003", "42788"],
  "Minnesota": ["55001", "56763"],
  "Oklahoma": ["73001", "74966"],
  "Pennsylvania": ["15001", "19640"],
  "New Mexico": ["87001", "88439"],
  "Illinois": ["60001", "62999"],
  "Michigan": ["48001", "49971"],
  "Virginia": ["20101", "24658"],
  "West Virginia": ["24701", "26886"],
  "Mississippi": ["38601", "39776"],
  "Northern Mariana Islands": ["96950", "96952"],
  "Massachusetts": ["01001", "02791"],
  "Arizona": ["85001", "86556"],
  "Connecticut": ["06001", "06389"],
  "Florida": ["32003", "34997"],
  "District of Columbia": ["20001", "20020"],
  "Indiana": ["46001", "47997"],
  "Wisconsin": ["53001", "54990"],
  "Wyoming": ["82001", "83414"],
  "South Carolina": ["29001", "29945"],
  "Arkansas": ["71601", "72959"],
  "South Dakota": ["57001", "57799"],
  "Montana": ["59001", "59937"],
  "North Carolina": ["27006", "28909"],
  "Puerto Rico": ["00601", "00988"],
  "Colorado": ["80001", "81658"],
  "Missouri": ["63005", "65899"],
  "New York": ["10001", "14975"],
  "Maine": ["03901", "04992"],
  "Tennessee": ["37010", "38589"],
  "Georgia": ["30001", "31999"],
  "Alabama": ["35004", "36925"],
  "Louisiana": ["70001", "71497"],
  "Nevada": ["88901", "89883"],
  "Iowa": ["50001", "52809"],
  "Idaho": ["83201", "83877"],
  "Rhode Island": ["02801", "02940"],
  "Washington": ["98001", "99403"],
  "Ohio": ["43001", "45999"]
};

// --- Auth & Seller Config ---
const authFile = `auth-${process.env.SELLER || 'default'}.json`;
const sellersPath = path.join(__dirname, 'sellers.json');
const sellers = JSON.parse(fs.readFileSync(sellersPath, 'utf8'));
const sellerType = process.env.SELLER || 'lastSignup';
const { email, password } = sellers[sellerType];

//Run this to use custom seller from sellers.json file
//npx cross-env SELLER=customSeller npx playwright test tests/sellerstepper.spec.js --headed

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

// --- Step detection (URL-first) ---
async function detectStep(page) {
  const url = page.url();

  if (url.includes('/account-management/welcome')) {
    return 'Welcome';
  }
  if (url.includes('/account-management/account-type') && !url.includes('?step=')) {
  return 'Account Type';
}
  if (url.includes('?step=0')) {
    return 'Business Information';
  }
  if (url.includes('?step=1')) {
    return 'Primary Contact Information';
  }
  if (url.includes('?step=2')) {
    return 'Payment Information';
  }
  if (url.includes('?step=3')) {
    return 'Store and Product Information';
  }
  if (url.includes('?step=4')) {
    // Step 4 has two possible variants, disambiguate via heading
    if (await page.getByRole('heading', { level: 6, name: /Identity and Address Verification/i })
                 .isVisible().catch(() => false)) {
      return 'Identity and Address Verification';
    }
    if (await page.getByRole('heading', { level: 6, name: /Identity Verification/i })
                 .isVisible().catch(() => false)) {
      return 'Identity Verification';
    }
    return 'Step 4 (unknown variant)';
  }
  // ✅ Handle dashboard
  if (url.includes('/dashboard')) {
    console.log('✅ Seller already completed stepper, now on dashboard.');
    return null; // no further steps
  }
  throw new Error(`⚠️ Unknown step. URL=${url}`);
}

// --- Step handlers ---
async function handleStep(page, step) {
  switch (step) {
    case 'Welcome':
  console.log('👀 Handling Welcome step...');
  const startButton = page.getByRole('button', { name: "Let's Start" });
  
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
    console.log('✅ Clicked "Let\'s Start", moving to Account Type step...');
    // Wait until redirected to Account Type page
    await page.waitForURL('**/account-management/account-type**', { timeout: 30000 });
  } else {
    console.log('➡️ Welcome already completed, skipping...');
  }
  break;

    case 'Account Type':
      console.log('⚙️ Handling Account Type step...');
      await page.locator('div').filter({ hasText: /^PrivatelyOwn Business$/ }).first().click();
      await expect(page.getByText('Business Account')).toBeVisible();
      await expect(page.getByText('I confirm my account type are correct, and I understand that this information cannot be changed later.')).toBeVisible();
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

      // 🌍 Shared full countries list
const countries = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo","Congo, Democratic Republic of the",
  "Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti",
  "Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea",
  "Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia",
  "Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau",
  "Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq",
  "Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati",
  "Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya",
  "Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives",
  "Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia",
  "Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia",
  "Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria",
  "North Macedonia","Norway","Oman","Pakistan","Palau","Panama","Papua New Guinea",
  "Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia",
  "Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines",
  "Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia",
  "Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
  "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan",
  "Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand",
  "Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan",
  "Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States",
  "Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen",
  "Zambia","Zimbabwe"
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

  // --- Bank selection ---
  const banks = [
    "Ally Bank",
    "Bank of America",
    "BMO Harris Bank",
    "Capital One Bank",
    "Citibank",
    "Citizens Bank",
    "Comerica Bank",
    "Example Bank",
    "Fifth Third Bank",
    "HSBC Bank USA",
    "Huntington Bank",
    "JPMorgan Chase Bank",
    "KeyBank",
    "M&T Bank",
    "PNC Bank",
    "Regions Bank",
    "Santander Bank",
    "TD Bank",
    "Truist Bank (formerly BB&T and SunTrust)",
    "U.S. Bank",
    "Wells Fargo Bank"
  ];

  const randomBank = banks[Math.floor(Math.random() * banks.length)];
  console.log(`🏦 Selected Bank: ${randomBank}`);

  await page.getByRole('combobox', { name: 'Select Bank' }).click();
  await page.getByRole('option', { name: randomBank }).click();

  // --- Routing number selection ---
  const routingNumbers = [
    "011000015", // Federal Reserve Bank - Boston
    "021000021", // JPMorgan Chase - New York
    "031000053", // PNC Bank - Pittsburgh
    "041000124", // Huntington National Bank - Columbus
    "051000017", // Wells Fargo - Richmond
    "061000104", // Bank of America - Atlanta
    "071000013", // Chase Bank - Chicago
    "081000210", // Regions Bank - St. Louis
    "091000019", // U.S. Bank - Minneapolis
    "101000187"  // Commerce Bank - Kansas City
  ];

  const randomRouting = routingNumbers[Math.floor(Math.random() * routingNumbers.length)];
  console.log(`🔢 Selected Routing Number: ${randomRouting}`);

  await page.getByRole('textbox', { name: /Routing Number/i }).fill(randomRouting);

  // --- Account number generation (10–12 digits) ---
  function randomAccountNumber() {
    const length = Math.floor(Math.random() * 3) + 10; // 10, 11, or 12
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
  }

  const accountNumber = randomAccountNumber();
  console.log(`🏦 Generated Account Number: ${accountNumber}`);

  await page.getByRole('textbox', { name: /^Account Number/i, exact: true }).fill(accountNumber);
  await page.getByRole('textbox', { name: /Re-enter Bank Account Number/i }).fill(accountNumber);

  // --- Continue to next step ---
  await saveAndNext(page, 'Store and Product Information');
  break;

    case 'Store and Product Information':
  console.log('🏬 Filling Store and Product Information step...');

  // --- Unique store name ---
  const storeName = `Store_${Date.now()}`;
  await page.getByRole('textbox', { name: 'Enter your store name *' }).fill(storeName);

  // --- Radios (choose randomly Yes/No) ---
  const radioChoices = ['Yes', 'No'];
  const firstRadio = radioChoices[Math.floor(Math.random() * radioChoices.length)];
  const secondRadio = radioChoices[Math.floor(Math.random() * radioChoices.length)];
  await page.getByRole('radio', { name: firstRadio }).first().check();
  await page.getByRole('radio', { name: secondRadio }).nth(1).check();

  // --- Random answers (>20 chars) ---
  const randomAnswer = `This is a long enough random answer for testing ${Math.random().toString(36).slice(2, 10)}`;
  const randomDescription = `My business description is sufficiently long for validation ${Math.random().toString(36).repeat(2)}`;

  await page.getByRole('textbox', { name: 'Enter Answer *' }).fill(randomAnswer);
  await page.getByRole('textbox', { name: 'Enter description *' }).fill(randomDescription);

  // --- Address ---
  await page.getByRole('textbox', { name: 'Address Name *' }).fill('Business Warehouse Address');
  await page.getByRole('textbox', { name: 'Address Line 1 *' }).fill('Business warehouse address 1');
  await page.getByRole('textbox', { name: 'Address Line 2' }).fill('Business warehouse address 2');

  // --- State + ZIP selection ---
  const statesStore = Object.keys(stateZipMap);
  const randomStateStore = statesStore[Math.floor(Math.random() * statesStore.length)];
  const zipsStore = stateZipMap[randomStateStore];
  const randomZipStore = zipsStore[Math.floor(Math.random() * zipsStore.length)];

  console.log(`🌍 Selected Store State: ${randomStateStore}, ZIP: ${randomZipStore}`);

  // City = first two letters of state
  const cityStore = randomStateStore.substring(0, 2).toUpperCase();
  await page.getByRole('textbox', { name: 'City/Town *' }).fill(cityStore);

  // Select state from dropdown
  const stateDropdownStore = page.getByRole('combobox', { name: 'State/Region' }).first();
  await stateDropdownStore.click();
  const optionStore = page.getByRole('option', { name: randomStateStore });
  await expect(optionStore).toBeVisible({ timeout: 5000 });
  await optionStore.click();

  // Fill ZIP matching state
  await page.getByRole('textbox', { name: 'ZIP/Postal Code *' }).fill(randomZipStore);

  // --- Continue ---
  await saveAndNext(page, 'Identity and Address Verification');
  break;

  case 'Identity and Address Verification':
  console.log('🏬 Filling Identity and Address Verification step...');

  // detect if documents are already uploaded (no file inputs present)
  const fileInputs = page.locator('input[type="file"]');
  const fileCount = await fileInputs.count();

  if (fileCount === 0) {
    console.log('⚡ Docs already uploaded, skipping upload.');
    await page.getByRole('button', { name: 'Save and Next' }).click();
    break;
  }

  // otherwise, upload as normal
  const companyImage = imagePath('817UJvB1BrL._SL1500_.jpg');
  const dlFront      = imagePath('71VBGavZfcL._SL1500_.jpg');
  const dlBack       = imagePath('81aKZJZEUEL._SL1500_.jpg');

  await expect(fileInputs).toHaveCount(3, { timeout: 10000 });

  await fileInputs.nth(0).setInputFiles(companyImage);
  console.log('📸 Uploaded company registration image');

  await fileInputs.nth(1).setInputFiles(dlFront);
  console.log('📸 Uploaded DL front image');

  await fileInputs.nth(2).setInputFiles(dlBack);
  console.log('📸 Uploaded DL back image');

  await page.getByRole('button', { name: 'Save and Next' }).click();
  break;

  case 'Identity Verification':
  console.log('🏬 Filling Identity Verification step...');

  // --- Step 2: Pick a random date (3rd–9th of that month) ---
  const day = Math.floor(Math.random() * 7) + 3; // 3–9

  // get all enabled gridcells with that day number
  const dayCells = page.getByRole('gridcell', { name: String(day), exact: true })
    .filter({ hasNot: page.locator('[disabled]') });

  // ✅ Manual assertion (no redeclare issue)
  const dayCount = await dayCells.count();
  expect(dayCount).toBeGreaterThan(0);

  // click the first enabled one
  await dayCells.first().click();
  console.log(`📅 Picked appointment date (day): ${day}`);

  // --- Step 3: Select a random region ---
  await page.getByRole('combobox', { name: 'Select Region' }).click();

  const regions = [
    "Eastern Time (ET) GMT-04:00",
    "Central Time (CT) GMT-05:00",
    "Mountain Time (MT) GMT-06:00",
    "Pacific Time (PT) GMT-07:00",
    "Alaska Time (AKT) GMT-08:00",
    "Hawaii-Aleutian Time (HAT) GMT-10:00",
    "Atlantic Time (AT) GMT-04:00",
    "Samoa Time (SST) GMT-11:00",
    "Chamorro Time (ChT) GMT+10:00"
  ];

  const region = regions[Math.floor(Math.random() * regions.length)];
  await page.getByRole('option', { name: region }).click();
  console.log(`🌍 Selected region: ${region}`);

  // --- Step 4: Pick a timeslot (must select to proceed) ---
  await page.getByRole('combobox', { name: 'Time' }).click();

  const timeOptions = page.getByRole('option');
  await expect(timeOptions.first()).toBeVisible({ timeout: 5000 });
  const timeCount = await timeOptions.count(); // ✅ different name

  if (timeCount === 0) {
    throw new Error(`❌ No available timeslots for chosen date (day ${day}) in ${region}`);
  }

  // random available slot
  const randomSlotIndex = Math.floor(Math.random() * timeCount);
  const slotText = await timeOptions.nth(randomSlotIndex).textContent();
  await timeOptions.nth(randomSlotIndex).click();
  console.log(`⏰ Selected timeslot: ${slotText}`);

  // ✅ Wait until combobox reflects the selected slot instead of using timeout
  await expect(page.getByRole('combobox', { name: 'Time' })).toHaveValue(slotText, { timeout: 5000 });

  // --- Step 5: Save & Finish ---
  await page.getByRole('button', { name: 'Save and Finish' }).click();
  console.log('✅ Appointment booked & stepper finished → Dashboard');

  // --- Step 6: Verify seller is on dashboard ---
  await expect(page).toHaveURL(/dashboard/);
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

  if (page.url().includes('/welcome')) {
  console.log('👀 Seller landed on Welcome page, waiting for "Let\'s Start" button...');

  // Wait for the button to appear and click it
  const startButton = page.getByRole('button', { name: "Let's Start" });
  await expect(startButton).toBeVisible({ timeout: 15000 });
  await startButton.click();
  console.log('✅ Clicked "Let\'s Start", moving to Account Type step...');

  // Wait for stepper page to load
  await page.waitForURL('**/account-management/account-type/business/create-account?step=0', { timeout: 30000 });
  console.log(`➡️ Stepper started: ${page.url()}`);
}

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