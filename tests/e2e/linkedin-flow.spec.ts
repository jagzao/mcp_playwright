import { test, expect } from '@playwright/test';

test.describe('LinkedIn Profile Analysis Flow', () => {
  test.use({
    headless: false,
    video: 'on',
    screenshot: 'on',
  });

  test('should login to LinkedIn and analyze profile', async ({ page }) => {
    // This is a manual E2E test - requires valid credentials in .env

    // Navigate to LinkedIn login
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Wait for login form
    await page.waitForSelector('#username', { timeout: 10000 });

    // Fill credentials
    await page.fill('#username', process.env.LINKEDIN_EMAIL || '');
    await page.waitForTimeout(1000);

    await page.fill('#password', process.env.LINKEDIN_PASSWORD || '');
    await page.waitForTimeout(1000);

    // Click submit
    await page.click('button[type="submit"]');

    // Wait for login to complete
    await page.waitForTimeout(10000);

    // Check if we're logged in (look for feed or profile button)
    const loggedIn = await page.evaluate(() => {
      const feedElement = document.querySelector('[data-control-name="feed"]');
      const profileButton = document.querySelector('[data-control-name="identity_welcome_message"]');
      return !!(feedElement || profileButton);
    });

    if (!loggedIn) {
      console.log('⚠️ Login may require 2FA or verification - check browser');
      // Wait for manual intervention if needed
      await page.waitForTimeout(30000);
    }

    // Navigate to profile
    await page.goto('https://www.linkedin.com/in/me/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({
      path: 'data/screenshots/e2e-linkedin-profile.png',
      fullPage: true,
    });

    // Extract basic profile info
    const profileData = await page.evaluate(() => {
      const data: any = {};

      // Check for headline
      const headline = document.querySelector('.text-body-medium');
      data.hasHeadline = !!headline?.textContent;

      // Check for photo
      const photo = document.querySelector('img[data-ghost-classes*="profile"]');
      data.hasPhoto = !!photo;

      // Check for about section
      const about = document.querySelector('#about');
      data.hasAbout = !!about;

      // Check for experience section
      const experience = document.querySelector('#experience');
      data.hasExperience = !!experience;

      return data;
    });

    console.log('Profile analysis:', profileData);

    // Assertions
    expect(profileData.hasPhoto).toBeTruthy();
    expect(profileData.hasHeadline).toBeTruthy();
  });

  test('should detect intent for LinkedIn profile', async () => {
    // Unit test for intent detection
    const IntentDetector = (await import('../../agent/src/planner/intent-detector.js')).IntentDetector;
    const detector = new IntentDetector();

    const intent1 = detector.detectIntent('entra a mi linkedin y analiza que mi perfil este completamente optimizado');
    expect(intent1.type).toBe('linkedin_profile_view');
    expect(intent1.confidence).toBeGreaterThan(0.85);
    expect(intent1.suggestedActions).toBeDefined();

    const intent2 = detector.detectIntent('login to linkedin');
    expect(intent2.type).toBe('linkedin_login');
    expect(intent2.confidence).toBeGreaterThan(0.85);
  });

  test('should have pre-planned actions for LinkedIn flows', async () => {
    const IntentDetector = (await import('../../agent/src/planner/intent-detector.js')).IntentDetector;
    const detector = new IntentDetector();

    const intent = detector.detectIntent('login to linkedin');
    expect(intent.suggestedActions).toBeDefined();
    expect(intent.suggestedActions!.length).toBeGreaterThan(5);

    // Check first action is navigate to login
    expect(intent.suggestedActions![0].type).toBe('navigate');
    expect(intent.suggestedActions![0].url).toContain('linkedin.com/login');

    // Check we have fill actions for credentials
    const fillActions = intent.suggestedActions!.filter(a => a.type === 'fill');
    expect(fillActions.length).toBeGreaterThanOrEqual(2);
  });
});
