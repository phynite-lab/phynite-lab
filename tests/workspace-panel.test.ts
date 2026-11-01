import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampRightPanelWidth,
  getDynamicRightPanelMaxWidth,
  RIGHT_PANEL_HARD_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '../lib/workspace-panel.ts';

test('shared shell uses its actual remaining container width', () => {
  assert.equal(getDynamicRightPanelMaxWidth(0, 936), 336);
  assert.equal(clampRightPanelWidth(420, 0, 936), 336);
  assert.equal(getDynamicRightPanelMaxWidth(0, 1096), 496);
  assert.equal(getDynamicRightPanelMaxWidth(0, 700), RIGHT_PANEL_MIN_WIDTH);
  assert.equal(getDynamicRightPanelMaxWidth(0, 2000), RIGHT_PANEL_HARD_MAX_WIDTH);
});

test('dynamic max width defaults to 420 on SSR or narrow/laptop screens (<= 1400px)', () => {
  // Test when window is defined with laptop width
  const originalWindow = globalThis.window;
  try {
    // @ts-expect-error Mock window for test
    globalThis.window = { innerWidth: 1366 };
    assert.equal(getDynamicRightPanelMaxWidth(232), 420);
    assert.equal(clampRightPanelWidth(500, 232), 420);
    assert.equal(clampRightPanelWidth(300, 232), RIGHT_PANEL_MIN_WIDTH);

    // Exactly at 1400 breakpoint
    // @ts-expect-error Mock window for test
    globalThis.window = { innerWidth: 1400 };
    assert.equal(getDynamicRightPanelMaxWidth(232), 420);
    assert.equal(clampRightPanelWidth(600, 232), 420);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('dynamic max width expands up to 700px on wider screens while protecting 600px canvas space', () => {
  const originalWindow = globalThis.window;
  try {
    // Screen 1450px with 232px sidebar: 1450 - 232 - 600 = 618px
    // @ts-expect-error Mock window for test
    globalThis.window = { innerWidth: 1450 };
    assert.equal(getDynamicRightPanelMaxWidth(232), 618);
    assert.equal(clampRightPanelWidth(500, 232), 500);
    assert.equal(clampRightPanelWidth(650, 232), 618);

    // Full HD 1920px screen: 1920 - 232 - 600 = 1088px -> capped at 700px
    // @ts-expect-error Mock window for test
    globalThis.window = { innerWidth: 1920 };
    assert.equal(getDynamicRightPanelMaxWidth(232), RIGHT_PANEL_HARD_MAX_WIDTH);
    assert.equal(clampRightPanelWidth(600, 232), 600);
    assert.equal(clampRightPanelWidth(700, 232), 700);
    assert.equal(clampRightPanelWidth(800, 232), 700);
    assert.equal(clampRightPanelWidth(320, 232), 320);
    assert.equal(clampRightPanelWidth(250, 232), 320);

    // Ultrawide / 2K / 4K (e.g. 2560px or 3440px)
    // @ts-expect-error Mock window for test
    globalThis.window = { innerWidth: 2560 };
    assert.equal(getDynamicRightPanelMaxWidth(232), RIGHT_PANEL_HARD_MAX_WIDTH);
    assert.equal(clampRightPanelWidth(900, 232), RIGHT_PANEL_HARD_MAX_WIDTH);
  } finally {
    globalThis.window = originalWindow;
  }
});
