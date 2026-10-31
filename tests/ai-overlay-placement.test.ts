import assert from 'node:assert/strict';
import test from 'node:test';
import { placeAiOverlay, type AiOverlayRect, type AiOverlayViewport } from '../lib/ai-overlay-placement.ts';

const rect = (left: number, top: number, width: number, height: number): AiOverlayRect => ({ left, top, right: left + width, bottom: top + height, width });
const viewport: AiOverlayViewport = { left: 12, right: 1428, top: 12, bottom: 988 };
const panes = rect(56, 44, 1384, 956), composer = rect(348, 810, 800, 150), anchor = rect(1040, 910, 80, 32);

test('compact composer uses workspace panes for room above the whole composer', () => {
  const result = placeAiOverlay({ viewport, pane: composer, bounds: panes, anchor, compact: true, align: 'end', contentHeight: 400, minimumHeight: 104 });
  assert.equal(result.side, 'above');
  assert.equal(result.top + 400, composer.top - 8);
  assert.equal(result.left + result.width, anchor.right);
  assert.equal(result.width, 400);
});

test('floating popup respects its header and switches sides using measured content', () => {
  const pane = rect(900, 100, 500, 750), trigger = rect(1250, 350, 90, 32);
  const result = placeAiOverlay({ viewport, pane, bounds: pane, anchor: trigger, headerBottom: 160, contentHeight: 300, minimumHeight: 100 });
  assert.equal(result.side, 'below');
  assert.equal(result.top, trigger.bottom + 8);
  assert.ok(result.left + result.width <= pane.right - 12);
  const shorter = placeAiOverlay({ viewport, pane, bounds: pane, anchor: trigger, headerBottom: 160, contentHeight: 150, minimumHeight: 100 });
  assert.equal(shorter.side, 'above');
  assert.ok(shorter.top >= 166);
});

test('short desktop content uses available popup space before falling back to a sheet', () => {
  const pane = rect(500, 400, 600, 250), trigger = rect(900, 570, 90, 32);
  const result = placeAiOverlay({ viewport, pane, bounds: pane, anchor: trigger, contentHeight: 120, minimumHeight: 90 });
  assert.equal(result.side, 'above');
  assert.equal(result.top, 442);
  const constrained = placeAiOverlay({ viewport, pane, bounds: rect(500, 540, 600, 85), anchor: trigger, contentHeight: 120, minimumHeight: 90 });
  assert.equal(constrained.side, 'sheet');
});

test('mobile sheet fits 320 and 390 pixel viewports with virtual keyboard offsets', () => {
  for (const width of [320, 390]) {
    const mobile = { left: 12, right: width - 12, top: 212, bottom: 588 };
    const result = placeAiOverlay({ viewport: mobile, pane: rect(8, 500, width - 16, 110), bounds: panes, anchor, compact: true, contentHeight: 900, minimumHeight: 104 });
    assert.equal(result.side, 'sheet');
    assert.equal(result.left, 12);
    assert.equal(result.width, width - 24);
    assert.equal(result.top, 212);
    assert.equal(result.maxHeight, 376);
  }
});

test('safe viewport gutters and narrow split pane constrain both edges', () => {
  const safe = { left: 40, right: 1360, top: 32, bottom: 920 }, pane = rect(1100, 80, 260, 800);
  const result = placeAiOverlay({ viewport: safe, pane, bounds: pane, anchor: rect(1320, 800, 30, 40), contentHeight: 1000, minimumHeight: 104 });
  assert.equal(result.width, 236);
  assert.ok(result.left >= safe.left);
  assert.ok(result.left + result.width <= safe.right);
  assert.ok(result.top >= safe.top);
  assert.equal(result.maxHeight, 560);
});

test('tablet keyboard and visual viewport offsets never leave anchored popups offscreen', () => {
  for (const visible of [{ left: 12, right: 1012, top: 12, bottom: 488 }, { left: 112, right: 1112, top: 512, bottom: 988 }]) {
    const hiddenComposer = rect(200, visible.top < 100 ? 810 : 100, 800, 150);
    const result = placeAiOverlay({ viewport: visible, pane: hiddenComposer, bounds: panes, anchor: rect(800, hiddenComposer.top + 100, 80, 32), compact: true, contentHeight: 300, minimumHeight: 104 });
    assert.equal(result.side, 'sheet');
    assert.ok(result.top >= visible.top);
    assert.ok(result.top + result.maxHeight <= visible.bottom);
  }
});

test('RTL flips start and end alignment without escaping the pane', () => {
  const trigger = rect(700, 910, 80, 32), options = { viewport, pane: composer, bounds: panes, anchor: trigger, compact: true, contentHeight: 200, minimumHeight: 104 };
  assert.equal(placeAiOverlay({ ...options, rtl: true, align: 'start' }).left + 400, trigger.right);
  assert.equal(placeAiOverlay({ ...options, rtl: true, align: 'end' }).left, trigger.left);
});
