import { expect, test, type Page } from '@playwright/test';

async function enterContinuityStage(page: Page) {
  // Skip splash video so it never blocks pointer events mid-test.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('panoref-splash-seen', '1');
    } catch {
      // ignore
    }
  });

  await page.goto('/');

  // Mode chooser appears when appMode is null after splash.
  const modeChooser = page.locator('[data-mode-chooser]');
  const continuity = page.getByRole('button', { name: /Build continuity packages/i });
  if (await modeChooser.isVisible().catch(() => false)) {
    await continuity.click();
  } else {
    // Wait briefly in case chooser is still mounting.
    try {
      await modeChooser.waitFor({ state: 'visible', timeout: 3000 });
      await continuity.click();
    } catch {
      // Already in a mode from a previous session (should not happen with clean context).
    }
  }

  // Ensure any residual splash is gone.
  const splash = page.getByRole('dialog', { name: 'Continuity Stage splash' });
  if (await splash.isVisible().catch(() => false)) {
    await splash.click({ force: true });
    await expect(splash).toBeHidden({ timeout: 5000 });
  }

  await expect(workspaceTab(page, 'Build')).toBeVisible({ timeout: 15000 });
  await expect(modeChooser).toBeHidden({ timeout: 5000 }).catch(() => undefined);
}

function workspaceTab(page: Page, label: 'Build' | 'Reference' | 'Shots' | 'Export') {
  // Mobile + desktop both render stage navs; only the visible one is interactive.
  return page
    .locator('header nav button')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
    .locator('visible=true')
    .first();
}

async function dismissOverlays(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let dismissed = false;
    for (const label of ['Got it', 'Not right now', 'Start checking', 'Close']) {
      const button = page.getByRole('button', { name: label, exact: true });
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(() => undefined);
        dismissed = true;
        await page.waitForTimeout(200);
      }
    }
    // Fallback: close any open modal backdrop.
    const backdrop = page.getByRole('button', { name: 'Close dialog backdrop' });
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true }).catch(() => undefined);
      dismissed = true;
      await page.waitForTimeout(200);
    }
    if (!dismissed) break;
  }
}

test.describe('layout and core chrome', () => {
  test('header actions stay in viewport', async ({ page }, testInfo) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);

    const brand = page.locator('[data-brand-menu-trigger]');
    const actions = page.locator('[data-header-actions]');
    await expect(brand).toBeVisible();
    await expect(actions).toBeVisible();

    const brandBox = await brand.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(brandBox).toBeTruthy();
    expect(actionsBox).toBeTruthy();
    if (!brandBox || !actionsBox) return;

    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    if (!viewport) return;

    expect(brandBox.x).toBeGreaterThanOrEqual(0);
    expect(brandBox.y).toBeGreaterThanOrEqual(0);
    expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(viewport.height);

    if (testInfo.project.name === 'phone-390') {
      const stageNav = page.getByRole('navigation', { name: 'Workspace stages' });
      await expect(stageNav).toBeVisible();
      const navBox = await stageNav.boundingBox();
      expect(navBox).toBeTruthy();
      if (navBox) {
        expect(navBox.y).toBeGreaterThanOrEqual(brandBox.y + brandBox.height - 4);
        expect(navBox.x + navBox.width).toBeLessThanOrEqual(viewport.width + 2);
      }
    }
  });

  test('build tray is reachable without overflowing off-screen', async ({ page }, testInfo) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    const tray = page.locator('[data-build-object-tray]');
    await expect(tray).toBeVisible({ timeout: 15000 });
    const trayBox = await tray.boundingBox();
    expect(trayBox).toBeTruthy();
    if (!trayBox) return;

    const viewport = page.viewportSize();
    if (!viewport) return;
    expect(trayBox.x).toBeGreaterThanOrEqual(-2);
    expect(trayBox.y + trayBox.height).toBeLessThanOrEqual(viewport.height + 2);
    expect(trayBox.x + Math.min(trayBox.width, 40)).toBeLessThanOrEqual(viewport.width + 2);

    if (testInfo.project.name === 'phone-390') {
      // Shortcut badges make accessible names like "3 Box".
      const boxTool = tray.getByRole('button', { name: /Box/i }).first();
      await expect(boxTool).toBeVisible();
      const box = await boxTool.boundingBox();
      expect(box).toBeTruthy();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-2);
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
    } else {
      // Desktop should keep the tray content-sized instead of spanning the full viewport.
      expect(trayBox.width).toBeLessThan(viewport.width * 0.8);
    }
  });

  test('Build editor shortcuts expose multi-selection and clipboard feedback', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    await page.keyboard.press('Control+A');
    await expect(page.locator('[data-build-selection-count]')).toContainText(/objects selected/);
    await page.keyboard.press('Control+C');
    await expect(page.locator('[data-build-command-status]')).toContainText(/Copied/);
    await page.keyboard.press('Control+V');
    await expect(page.locator('[data-build-command-status]')).toContainText(/Pasted/);
    await page.keyboard.type('?');
    await expect(page.locator('[data-build-shortcut-reference]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-build-selection-count]')).toHaveCount(0);
  });
});

test.describe('workflow path smoke', () => {
  test('build graybox, approve reference, open shots and export', async ({ page }) => {
    test.setTimeout(180_000);
    await enterContinuityStage(page);
    await dismissOverlays(page);

    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    const renderBtn = page.getByRole('button', { name: /Render 360 Reference/i });
    if (await renderBtn.isVisible().catch(() => false)) {
      await renderBtn.click();
      await expect(
        page.getByRole('button', { name: /Download Graybox|Re-render after scene changes/i }).first(),
      ).toBeVisible({ timeout: 90_000 });
    }

    await dismissOverlays(page);
    const continueRef = page.getByRole('button', { name: /Continue to Reference/i });
    if (await continueRef.isVisible().catch(() => false)) {
      await continueRef.click();
    } else {
      await workspaceTab(page, 'Reference').click();
    }
    await dismissOverlays(page);

    const useAttached = page.getByRole('button', { name: /Use Attached Reference/i });
    if (await useAttached.isVisible().catch(() => false)) {
      await useAttached.click();
      await dismissOverlays(page);
    }

    const looksGood = page.getByRole('button', { name: /Looks good enough/i });
    if (await looksGood.isVisible().catch(() => false)) {
      await looksGood.click();
    }

    await dismissOverlays(page);

    const approve = page.getByRole('button', { name: /Approve as Reference/i });
    await expect(approve).toBeVisible({ timeout: 30_000 });
    await approve.click({ force: true });

    const dialogs = page.locator('[role="dialog"][aria-modal="true"]');
    await expect.poll(() => dialogs.count()).toBeLessThanOrEqual(1);
    await dismissOverlays(page);

    const continueShots = page.getByRole('button', { name: /Continue to Shots/i });
    if (await continueShots.isVisible().catch(() => false)) {
      await continueShots.click();
    } else {
      await workspaceTab(page, 'Shots').click();
    }
    await dismissOverlays(page);

    await expect(page.locator('[data-shots-camera-shell]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-shots-shutter]')).toBeVisible();

    await workspaceTab(page, 'Export').click();
    await dismissOverlays(page);
    await expect(page.getByRole('button', { name: /Export Selected Shots|Export \d+ Shots/i })).toBeVisible();
  });

  test('repeated still captures create distinct persisted shot thumbnails', async ({ page }) => {
    test.setTimeout(120_000);
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Shots').click();
    await dismissOverlays(page);

    const shutter = page.locator('[data-shots-shutter]');
    await expect(shutter).toBeVisible({ timeout: 20_000 });
    await shutter.click();
    // The capture flash is intentionally transient and can be covered immediately by
    // workflow guidance. The persisted cards below are the authoritative capture signal.
    await dismissOverlays(page);
    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    await shutter.click();

    await page.locator('[data-shots-library-thumb]').click();
    const cards = page.locator('[data-shots-library-card]');
    await expect(cards).toHaveCount(2, { timeout: 30_000 });
    await expect(cards.locator('img')).toHaveCount(2, { timeout: 30_000 });
    const thumbnailSources = await cards.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));

    expect(thumbnailSources).toHaveLength(2);
    expect(thumbnailSources[0]).toMatch(/^data:image\//);
    expect(thumbnailSources[1]).toMatch(/^data:image\//);
    expect(thumbnailSources[0]).not.toBe(thumbnailSources[1]);
  });
});
