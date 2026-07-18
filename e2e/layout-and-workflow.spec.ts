import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { createDefaultProject, createTransform } from '../src/domain/defaults';
import { encodeBinaryGrayboxMesh, MODEL_ASSET_URI_PREFIX } from '../src/engine/importedMesh';

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

function multiNodeGltfBuffer() {
  const positions = Buffer.alloc(72);
  [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
    [5, 0, 0], [6, 0, 0], [5, 1, 0],
  ].flat().forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(12);
  [0, 1, 2, 0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  return Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.byteLength, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 72 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
      { buffer: 0, byteOffset: 78, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 0, byteOffset: 36, componentType: 5126, count: 3, type: 'VEC3', min: [5, 0, 0], max: [6, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 2 }] },
      { primitives: [{ attributes: { POSITION: 1 }, indices: 3 }] },
    ],
    nodes: [
      { mesh: 0, name: 'LeftPanel' },
      { mesh: 1, name: 'RightPanel' },
    ],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  }));
}

async function reopenableModelPackage() {
  const createdAt = '2026-07-18T00:00:00.000Z';
  const project = createDefaultProject();
  project.name = 'Reopenable imported model';
  const key = 'e2e/reopenable-mesh';
  const packed = encodeBinaryGrayboxMesh(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
  );
  project.assets.assets['reopenable-mesh'] = {
    id: 'reopenable-mesh',
    type: 'model',
    name: 'reopenable-triangle.panoref-mesh',
    uri: `${MODEL_ASSET_URI_PREFIX}${key}`,
    mimeType: 'application/vnd.panoref.graybox-mesh',
    createdAt,
  };
  project.scene.objects.push({
    id: 'reopenable-object',
    name: 'Reopenable triangle',
    type: 'imported_model',
    transform: createTransform(),
    dimensions: [1, 1, 0.001],
    category: 'architecture',
    locked: false,
    visible: true,
    modelAssetId: 'reopenable-mesh',
  });
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project));
  zip.file(`model-assets/${encodeURIComponent(key)}.bin`, packed.buffer);
  return zip.generateAsync({ type: 'nodebuffer' });
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
    } else {
      expect(actionsBox.x).toBeGreaterThan(viewport.width / 2);
      expect(viewport.width - (actionsBox.x + actionsBox.width)).toBeLessThanOrEqual(32);
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

  test('imports a texture-free OBJ through the Build tray', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    await page.locator('[data-build-object-tray]').getByRole('button', { name: 'More' }).click();
    await page.locator('[data-build-import-model]').click();
    const dialog = page.getByRole('dialog', { name: /Import 3D/ });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-model-import-input]').setInputFiles({
      name: 'triangle.obj',
      mimeType: 'text/plain',
      buffer: Buffer.from([
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'f 1 2 3',
      ].join('\n')),
    });

    await expect(dialog.getByText(/Imported 1 selectable object/)).toBeVisible();
    await dialog.getByText('Close', { exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Selected object name' })).toHaveValue('triangle');
  });

  test('reopens a binary-backed imported-model project package', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await page.locator('[data-project-import-input]').setInputFiles({
      name: 'reopenable-model.panoref-project',
      mimeType: 'application/zip',
      buffer: await reopenableModelPackage(),
    });
    await expect(page.locator('[data-project-import-status="success"]')).toBeVisible();
    await page.getByTitle('Scene layers').click();
    await expect(page.getByText('Reopenable triangle', { exact: true })).toBeVisible();
  });

  test('imports separate multi-node scenes with one report card per source file', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    await page.locator('[data-build-object-tray]').getByRole('button', { name: 'More' }).click();
    await page.locator('[data-build-import-model]').click();
    const dialog = page.getByRole('dialog', { name: /Import 3D/ });
    await dialog.locator('[data-model-import-input]').setInputFiles({
      name: 'two-panels.gltf',
      mimeType: 'model/gltf+json',
      buffer: multiNodeGltfBuffer(),
    });

    await expect(dialog.getByText(/Imported 2 selectable objects/)).toBeVisible();
    await expect(dialog.locator('[data-model-import-report-item="success"]')).toHaveCount(1);
  });

  test('imports the same multi-node scene in combined mode', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    await page.locator('[data-build-object-tray]').getByRole('button', { name: 'More' }).click();
    await page.locator('[data-build-import-model]').click();
    const dialog = page.getByRole('dialog', { name: /Import 3D/ });
    await dialog.locator('[data-import-mode="combined"]').check();
    await dialog.locator('[data-model-import-input]').setInputFiles({
      name: 'two-panels.gltf',
      mimeType: 'model/gltf+json',
      buffer: multiNodeGltfBuffer(),
    });

    await expect(dialog.getByText(/Imported 1 combined object from 2 mesh nodes/)).toBeVisible();
    await expect(dialog.locator('[data-model-import-report-item="success"]')).toHaveCount(1);
  });

  test('Help documentation is searchable and returns to the active workspace', async ({ page }) => {
    await enterContinuityStage(page);
    await dismissOverlays(page);
    await workspaceTab(page, 'Build').click();
    await dismissOverlays(page);

    await page.getByRole('button', { name: 'Open app menu' }).click();
    await page.getByRole('menuitem', { name: 'Help & Documentation' }).click();
    await expect(page.locator('[data-help-workspace]')).toBeVisible();
    await expect(page.locator('img[src="/docs/build-workspace.png"]')).toHaveCount(1);
    await expect(page.locator('img[src="/docs/workflow-overview.png"]')).toHaveCount(1);

    const search = page.getByRole('searchbox', { name: 'Search documentation' });
    await search.fill('clipboard');
    await expect(page.locator('[data-help-section="shortcuts"]')).toBeVisible();
    await expect(page.locator('[data-help-section="welcome"]')).toHaveCount(0);
    await search.fill('');

    await page.getByRole('button', { name: 'Back to the app' }).click();
    await expect(page.locator('[data-build-object-tray]')).toBeVisible();
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
