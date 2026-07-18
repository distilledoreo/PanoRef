import { expect, test, type Locator, type Page } from '@playwright/test';

const SAMPLE_PANO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGBg+A8AAQQBAHAgZQsAAAAASUVORK5CYII=';

function projectionFixture() {
  const createdAt = '2026-07-18T00:00:00.000Z';
  const asset = (id: string, name: string) => ({
    id,
    type: 'image',
    name,
    uri: SAMPLE_PANO,
    mimeType: 'image/png',
    width: 2,
    height: 1,
    createdAt,
  });
  const pano = (id: string, name: string, type: 'graybox_render' | 'ai_global_reference', imageAssetId: string, isCanonical = false) => ({
    id,
    name,
    imageAssetId,
    type,
    projection: 'equirectangular',
    origin: [0, 1.65, 0],
    rotation: [0, 0, 0],
    width: 2,
    height: 1,
    isCanonical,
    sourcePanoId: type === 'ai_global_reference' ? 'graybox-a' : undefined,
    createdAt,
  });

  return {
    schemaVersion: '0.1',
    id: 'projection-assist-e2e',
    name: 'Projection Assist E2E',
    description: 'Rendered Projection Assist interaction fixture.',
    units: 'meters',
    createdAt,
    updatedAt: createdAt,
    scene: {
      worldUp: 'Y',
      objects: [],
      panoOrigin: [0, 1.65, 0],
      panoRotation: [0, 0, 0],
    },
    panoRefs: [
      pano('graybox-a', 'Graybox A', 'graybox_render', 'asset-graybox-a'),
      pano('graybox-b', 'Graybox B', 'graybox_render', 'asset-graybox-b'),
      pano('styled-a', 'Styled A', 'ai_global_reference', 'asset-styled-a', true),
      pano('styled-b', 'Styled B', 'ai_global_reference', 'asset-styled-b'),
    ],
    landmarks: [],
    shots: [],
    assets: {
      assets: {
        'asset-graybox-a': asset('asset-graybox-a', 'graybox-a.png'),
        'asset-graybox-b': asset('asset-graybox-b', 'graybox-b.png'),
        'asset-styled-a': asset('asset-styled-a', 'styled-a.png'),
        'asset-styled-b': asset('asset-styled-b', 'styled-b.png'),
      },
    },
    settings: {
      defaultShotWidth: 3840,
      defaultShotHeight: 2160,
      defaultShotFovDegrees: 65,
      defaultCameraLensMm: 35,
      defaultCameraHeightMeters: 1.65,
      panoGoodMatchMeters: 1.5,
      panoModerateMatchMeters: 4,
      panoLetterboxExports169: true,
      projectedStyle: {
        panoId: 'styled-a',
        blendMode: 'primary_only',
        opacity: 1,
        exposure: 1,
        lightingContribution: 0,
        fallbackMode: 'clay',
      },
    },
    workflow: {
      shotFramingAcceptedAtByShotId: {},
      aiBriefSentAtByShotId: {},
      finalPackageExportedAtByShotId: {},
    },
  };
}

async function enterContinuityStage(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('panoref-splash-seen', '1');
    } catch {
      // ignore
    }
  });
  await page.goto('/');
  const modeChooser = page.locator('[data-mode-chooser]');
  const continuity = page.getByRole('button', { name: /Build continuity packages/i });
  if (await modeChooser.isVisible().catch(() => false)) await continuity.click();
  await expect(page.getByRole('button', { name: /^Build$/ }).first()).toBeVisible({ timeout: 15_000 });
}

async function dismissOverlays(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let dismissed = false;
    for (const label of ['Got it', 'Not right now', 'Start checking', 'Close']) {
      const button = page.getByRole('button', { name: label, exact: true });
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(() => undefined);
        dismissed = true;
        await page.waitForTimeout(150);
      }
    }
    if (!dismissed) break;
  }
}

function workspaceTab(page: Page, label: string) {
  return page.locator('header nav button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).locator('visible=true').first();
}

async function openProjectionEditor(page: Page): Promise<Locator> {
  await page.locator('[data-project-import-input]').setInputFiles({
    name: 'projection-assist-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(projectionFixture())),
  });
  await expect(page.locator('[data-project-import-status="success"]')).toBeVisible();
  await dismissOverlays(page);
  await workspaceTab(page, 'Reference').click();
  await dismissOverlays(page);
  const alignmentChrome = page.locator('[data-reference-alignment-chrome]');
  await expect(alignmentChrome).toBeVisible({ timeout: 15_000 });
  await alignmentChrome.getByRole('button', { name: 'More', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Reference Settings' });
  await expect(drawer).toBeVisible();
  await drawer.getByText('Advanced · Legacy point correction', { exact: true }).click();
  await drawer.locator('[data-projection-alignment-edit="styled-a"]').click();
  const editor = page.getByRole('dialog', { name: 'Fix local mismatches' });
  await expect(editor).toBeVisible();
  return editor;
}

async function openProjectionEditorFromDrawer(page: Page): Promise<Locator> {
  const drawer = page.getByRole('dialog', { name: 'Reference Settings' });
  await expect(drawer).toBeVisible();
  const edit = drawer.locator('[data-projection-alignment-edit="styled-a"]');
  if (!(await edit.isVisible())) await drawer.getByText('Advanced · Legacy point correction', { exact: true }).click();
  await edit.click();
  const editor = page.getByRole('dialog', { name: 'Fix local mismatches' });
  await expect(editor).toBeVisible();
  return editor;
}

async function selectTarget(editor: Locator, targetName: string) {
  await editor.getByRole('combobox', { name: 'Graybox panorama' }).selectOption({ label: targetName });
}

async function clickViewer(editor: Locator, pane: 'graybox' | 'styled', xFactor = 0.5) {
  const viewer = editor.locator(`[data-projection-viewer="${pane}"] [role="application"]`);
  await expect(viewer).toBeVisible();
  const box = await viewer.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  await viewer.click({ position: { x: Math.max(3, box.width * xFactor), y: box.height * 0.5 } });
}

async function createPair(editor: Locator, targetName = 'Graybox A', sourceXFactor = 0.5) {
  await selectTarget(editor, targetName);
  await clickViewer(editor, 'graybox');
  await clickViewer(editor, 'styled', sourceXFactor);
  await expect(editor.locator('[data-projection-match]')).toHaveCount(1);
}

test.describe('Projection Assist rendered workflow', () => {
  test('guards pending and disabled matches, and routes mobile picks between panes', async ({ page }, testInfo) => {
    await enterContinuityStage(page);
    const editor = await openProjectionEditor(page);
    await selectTarget(editor, 'Graybox A');

    await clickViewer(editor, 'graybox');
    await expect(editor.getByRole('button', { name: 'Use improved projection' })).toBeDisabled();
    if (testInfo.project.name === 'phone-390') {
      await expect(editor.locator('[data-projection-viewer="styled"]')).toHaveAttribute('data-mobile-viewer', 'active');
    }

    await clickViewer(editor, 'styled');
    await expect(editor.getByRole('button', { name: 'Use improved projection' })).toBeEnabled();
    if (testInfo.project.name === 'phone-390') {
      await expect(editor.locator('[data-projection-viewer="graybox"]')).toHaveAttribute('data-mobile-viewer', 'active');
    }

    if (testInfo.project.name !== 'phone-390') {
      const enabledMatch = editor.getByRole('checkbox', { name: 'Enable match 1' });
      await enabledMatch.uncheck();
      await expect(editor.getByRole('button', { name: 'Use improved projection' })).toBeDisabled();
    }
  });

  test('clears a pending point before changing graybox and confirms the discard', async ({ page }) => {
    await enterContinuityStage(page);
    const editor = await openProjectionEditor(page);
    await selectTarget(editor, 'Graybox A');
    await clickViewer(editor, 'graybox');

    let confirmation = '';
    page.once('dialog', async (dialog) => {
      confirmation = dialog.message();
      await dialog.accept();
    });
    await editor.getByRole('combobox', { name: 'Graybox panorama' }).selectOption({ label: 'Graybox B' });
    expect(confirmation).toMatch(/clears matches/i);
    await expect(editor.locator('[data-pano-marker="pending-target"]')).toHaveCount(0);
    await expect(editor.getByText('Click a feature in the graybox.')).toBeVisible();
  });

  test('does not warn again on close after switching away from a dirty source', async ({ page }) => {
    await enterContinuityStage(page);
    const editor = await openProjectionEditor(page);
    await createPair(editor);

    let switchConfirmation = '';
    page.once('dialog', async (dialog) => {
      switchConfirmation = dialog.message();
      await dialog.accept();
    });
    await editor.getByRole('combobox', { name: 'Styled panorama' }).selectOption({ label: 'Styled B' });
    expect(switchConfirmation).toMatch(/discarded/i);

    let closeConfirmation = false;
    page.once('dialog', async (dialog) => {
      closeConfirmation = true;
      await dialog.dismiss();
    });
    await editor.getByRole('button', { name: 'Close Projection Assist editor' }).click();
    expect(closeConfirmation).toBe(false);
    await expect(editor).toBeHidden();

    const reopened = await openProjectionEditorFromDrawer(page);
    await expect(reopened.locator('[data-projection-match]')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Close Projection Assist editor' }).click();
  });

  test('Cancel discards edits made after switching to another source panorama', async ({ page }) => {
    await enterContinuityStage(page);
    const editor = await openProjectionEditor(page);
    await editor.getByRole('combobox', { name: 'Styled panorama' }).selectOption({ label: 'Styled B' });
    await createPair(editor);

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();

    const reopened = await openProjectionEditorFromDrawer(page);
    await reopened.getByRole('combobox', { name: 'Styled panorama' }).selectOption({ label: 'Styled B' });
    await expect(reopened.locator('[data-projection-match]')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Close Projection Assist editor' }).click();
  });

  test('updates conflict markers from the current draft and leaves Cancel unapplied', async ({ page }) => {
    await enterContinuityStage(page);
    const editor = await openProjectionEditor(page);
    await selectTarget(editor, 'Graybox A');
    await clickViewer(editor, 'graybox', 0.5);
    await clickViewer(editor, 'styled', 0.2);
    await clickViewer(editor, 'graybox', 0.5);
    await clickViewer(editor, 'styled', 0.8);

    await expect(editor.locator('[data-pano-marker="target-match-1"]')).toHaveAttribute('aria-label', /conflicting/, { timeout: 15_000 });
    await expect(editor.locator('[data-pano-marker="target-match-2"]')).toHaveAttribute('aria-label', /conflicting/);
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();
  });
});
