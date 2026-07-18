import { expect, test, type Locator, type Page } from '@playwright/test';

const SAMPLE_PANO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGBg+A8AAQQBAHAgZQsAAAAASUVORK5CYII=';
function fixture() { const createdAt = '2026-07-18T00:00:00.000Z'; const asset = (id: string) => ({ id, type: 'image', name: `${id}.png`, uri: SAMPLE_PANO, mimeType: 'image/png', width: 2, height: 1, createdAt }); const pano = (id: string, name: string, type: string, imageAssetId: string, canonical = false) => ({ id, name, imageAssetId, type, projection: 'equirectangular', origin: [0, 1.65, 0], rotation: [0, 0, 0], width: 2, height: 1, isCanonical: canonical, createdAt }); return { schemaVersion: '0.1', id: 'region-fit-e2e', name: 'Region Fit E2E', description: '', units: 'meters', createdAt, updatedAt: createdAt, scene: { worldUp: 'Y', objects: [], panoOrigin: [0, 1.65, 0], panoRotation: [0, 0, 0] }, panoRefs: [pano('graybox-a', 'Graybox A', 'graybox_render', 'asset-gray'), pano('styled-a', 'Styled A', 'ai_global_reference', 'asset-style', true), pano('styled-b', 'Styled B', 'ai_global_reference', 'asset-style-b')], landmarks: [], shots: [], assets: { assets: { 'asset-gray': asset('asset-gray'), 'asset-style': asset('asset-style'), 'asset-style-b': asset('asset-style-b') } }, settings: { defaultShotWidth: 3840, defaultShotHeight: 2160, defaultShotFovDegrees: 65, defaultCameraLensMm: 35, defaultCameraHeightMeters: 1.65, panoGoodMatchMeters: 1.5, panoModerateMatchMeters: 4, panoLetterboxExports169: true, projectedStyle: { panoId: 'styled-a', blendMode: 'primary_only', opacity: 1, exposure: 1, lightingContribution: 0, fallbackMode: 'clay' } }, workflow: { shotFramingAcceptedAtByShotId: {}, aiBriefSentAtByShotId: {}, finalPackageExportedAtByShotId: {} } }; }
async function enter(page: Page) { await page.addInitScript(() => localStorage.setItem('panoref-splash-seen', '1')); await page.goto('/'); const chooser = page.locator('[data-mode-chooser]'); if (await chooser.isVisible().catch(() => false)) await page.getByRole('button', { name: /Build continuity packages/i }).click(); await expect(page.getByRole('button', { name: /^Build$/ }).first()).toBeVisible(); for (const label of ['Got it', 'Not right now', 'Close']) { const button = page.getByRole('button', { name: label, exact: true }); if (await button.isVisible().catch(() => false)) await button.click({ force: true }); } }
async function open(page: Page) { await page.locator('[data-project-import-input]').setInputFiles({ name: 'region.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) }); await expect(page.locator('[data-project-import-status="success"]')).toBeVisible(); for (const label of ['Got it', 'Not right now', 'Close']) { const button = page.getByRole('button', { name: label, exact: true }); if (await button.isVisible().catch(() => false)) await button.click({ force: true }); } await page.locator('header nav button').filter({ hasText: /^\s*Reference\s*$/ }).locator('visible=true').first().click(); const chrome = page.locator('[data-reference-alignment-chrome]'); await expect(chrome).toBeVisible(); await chrome.getByRole('button', { name: 'More', exact: true }).click(); const drawer = page.getByRole('dialog', { name: 'Reference Settings' }); await drawer.locator('[data-region-fit-card="styled-a"]').getByRole('button', { name: 'Add region' }).click(); const editor = page.getByRole('dialog', { name: 'Projection Assist Region Fit editor' }); await expect(editor).toBeVisible(); return editor; }
async function addRectangle(editor: Locator, mobile: boolean) {
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const viewer = editor.locator('section').filter({ hasText: /Draw around the region/ }).getByRole('application');
  const box = await viewer.boundingBox(); expect(box).toBeTruthy();
  if (box) await viewer.dragTo(viewer, { sourcePosition: { x: box.width * 0.4, y: box.height * 0.4 }, targetPosition: { x: box.width * 0.6, y: box.height * 0.6 } });
  if (mobile) { await expect(editor.getByRole('button', { name: 'Styled', exact: true })).toHaveClass(/bg-accent/); await editor.getByRole('button', { name: 'Review', exact: true }).click(); }
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let changed = false;
    for (const label of ['Got it', 'Not right now', 'Start checking', 'Close']) {
      const button = page.getByRole('button', { name: label, exact: true });
      if (await button.isVisible().catch(() => false)) { await button.click({ force: true }); changed = true; }
    }
    const backdrop = page.getByRole('button', { name: 'Close dialog backdrop' });
    if (await backdrop.isVisible().catch(() => false)) { await backdrop.click({ force: true }); changed = true; }
    if (!changed) break;
    await page.waitForTimeout(100);
  }
}

async function openRegionEditor(page: Page): Promise<Locator> {
  await page.locator('[data-project-import-input]').setInputFiles({ name: 'region.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) });
  await expect(page.locator('[data-project-import-status="success"]')).toBeVisible();
  await dismissDialogs(page);
  await page.locator('header nav button').filter({ hasText: /^\s*Reference\s*$/ }).locator('visible=true').first().click();
  await dismissDialogs(page);
  const chrome = page.locator('[data-reference-alignment-chrome]');
  await expect(chrome).toBeVisible();
  await chrome.getByRole('button', { name: 'More', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Reference Settings' });
  await drawer.locator('[data-region-fit-card="styled-a"]').getByRole('button', { name: 'Add region' }).click();
  const editor = page.getByRole('dialog', { name: 'Projection Assist Region Fit editor' });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('Projection Assist Region Fit rendered workflow', () => {
  test('creates paired topology, transforms, orders, previews, cancels, and persists', async ({ page }, testInfo) => {
    await enter(page); let editor = await openRegionEditor(page); const mobile = testInfo.project.name === 'phone-390';
    await addRectangle(editor, mobile);
    await expect(editor.getByRole('button', { name: /Apply/ })).toBeDisabled();
    await expect(editor.locator('[data-region-vertex]')).toHaveCount(mobile ? 0 : 8);
    await editor.getByRole('button', { name: 'Save region' }).click();
    await expect(editor.getByRole('button', { name: /Apply/ })).toBeEnabled();
    if (mobile) await editor.getByRole('button', { name: 'Styled', exact: true }).click();
    await editor.getByRole('button', { name: 'Move outline' }).click();
    await editor.getByRole('button', { name: 'Scale outline' }).click();
    await editor.getByRole('button', { name: 'Rotate outline' }).click();
    const handles = editor.locator('section').filter({ hasText: /Move the outline around/ }).locator('[data-region-vertex]'); await handles.first().dblclick();
    await expect(handles).toHaveCount(5);
    await handles.first().click(); await handles.first().press('Delete');
    await expect(handles).toHaveCount(4);
    if (mobile) await editor.getByRole('button', { name: 'Review', exact: true }).click();
    await addRectangle(editor, mobile); await editor.getByRole('button', { name: 'Save region' }).click();
    await expect(editor.locator('[data-region-row]')).toHaveCount(2);
    const rows = editor.locator('[data-region-row]'); await rows.nth(1).getByRole('button', { name: 'Move region up' }).click();
    await rows.first().getByRole('checkbox').uncheck(); await rows.first().getByRole('slider').fill('0.1');
    await editor.getByRole('button', { name: 'Preview', exact: true }).click(); await expect(editor.getByRole('button', { name: 'Edit regions' })).toBeVisible(); await editor.getByRole('button', { name: 'Edit regions' }).click();
    page.once('dialog', (dialog) => dialog.accept()); await editor.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(editor).toBeHidden();
    const drawer = page.getByRole('dialog', { name: 'Reference Settings' }); await expect(drawer.locator('[data-region-fit-card="styled-a"]')).toContainText('No Region Fit'); await drawer.locator('[data-region-fit-card="styled-a"]').getByRole('button', { name: 'Add region' }).click(); editor = page.getByRole('dialog', { name: 'Projection Assist Region Fit editor' });
    await addRectangle(editor, mobile); await editor.getByRole('button', { name: 'Save region' }).click(); await editor.getByRole('button', { name: /Apply/ }).click(); await expect(editor).toBeHidden(); await expect(drawer.locator('[data-region-fit-card="styled-a"]')).toContainText('1 regions');
    await drawer.locator('[data-region-fit-card="styled-a"]').getByRole('button', { name: 'Edit Region Fit' }).click(); editor = page.getByRole('dialog', { name: 'Projection Assist Region Fit editor' }); await expect(editor.locator('[data-region-row]')).toHaveCount(1);
  });

  test('confirms source changes and keeps incomplete regions unapplied', async ({ page }) => {
    await enter(page); const editor = await openRegionEditor(page); await addRectangle(editor, false);
    await expect(editor.getByRole('button', { name: /Apply/ })).toBeDisabled(); page.once('dialog', (dialog) => dialog.dismiss()); await editor.getByRole('combobox', { name: 'Styled panorama' }).selectOption('styled-b'); await expect(editor.getByRole('combobox', { name: 'Styled panorama' })).toHaveValue('styled-a');
  });
});
