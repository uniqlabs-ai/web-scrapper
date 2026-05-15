import { test, expect } from '@playwright/test';

test.describe('E2E Smoke Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept and mock NextAuth session so we don't need real Google OAuth in CI
    await page.route('**/api/auth/session', route => 
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { 
            name: 'Playwright Admin', 
            email: 'admin@test.local', 
            role: 'admin',
            permissions: null
          },
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        })
      })
    );
  });

  test('Dashboard loads cleanly and displays the app shell', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the hydration of the main Sidebar
    try {
      await expect(page.locator('text="Finance Founder OS"').or(page.locator('text="Founder OS"').first())).toBeVisible({ timeout: 10000 });
    } catch (e) {
      await page.screenshot({ path: 'artifacts/playwright_fail.png', fullPage: true });
      throw e;
    }

    // Ensure the Command Palette hook is present
    await expect(page.locator('text="Search..."')).toBeVisible();
  });

  test('Invoices can render dynamic modals', async ({ page }) => {
    await page.goto('/invoices');
    
    // Click 'New Invoice' button
    await page.click('button:has-text("New Invoice"), button:has-text("Create Invoice")');
    
    // Validate Modal opens up quickly
    await expect(page.locator('h3:has-text("Create Custom Invoice")').or(page.locator('text="Client Selection"'))).toBeVisible({ timeout: 5000 });
  });

  test('Settings Page renders Team & Access dynamically for admins', async ({ page }) => {
    await page.goto('/settings');
    
    // Click Team Tab
    await page.click('button:has-text("Team & Access")');
    
    // Validate RBAC management table renders
    await expect(page.locator('h3:has-text("Team Members & Roles")')).toBeVisible();
    await expect(page.locator('text="No team members yet"').or(page.locator('table'))).toBeVisible();
  });

});
