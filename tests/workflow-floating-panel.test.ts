import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowFloatingPanelPosition, workflowPanelMotionDuration } from '../lib/workflow-floating-panel.ts';

const panel = { width: 400, height: 300 }, container = { width: 1200, height: 800 };
const dock = { inset: 14, snapDistance: 32 };

test('panel motion retains its duration when built CSS switches between seconds and milliseconds', () => {
  assert.equal(workflowPanelMotionDuration('180ms'), 180);
  assert.equal(workflowPanelMotionDuration('.18s'), 180);
  assert.equal(workflowPanelMotionDuration(' 0.18s '), 180);
  assert.equal(workflowPanelMotionDuration('0ms'), 0);
  assert.equal(workflowPanelMotionDuration('0s'), 0);
  for (const value of ['', 'invalid', 'Infinity', '-1s']) assert.equal(workflowPanelMotionDuration(value), 180);
});

test('free movement preserves interior coordinates and the saved bottom anchor', () => {
  assert.deepEqual(workflowFloatingPanelPosition({ x: 200, y: 180 }, panel, container, dock), { x: 200, y: 180, bottom: 320 });
  assert.deepEqual(workflowFloatingPanelPosition({ x: 24, y: 24 }, panel, container), { x: 24, y: 24, bottom: 476 });
});

test('pointer release docks independently to all edges and corners with the workspace gutter', () => {
  for (const [x, expectedX] of [[30, 14], [770, 786]]) for (const [y, expectedY] of [[30, 14], [470, 486]]) {
    assert.deepEqual(workflowFloatingPanelPosition({ x, y }, panel, container, dock), { x: expectedX, y: expectedY, bottom: 500 - expectedY });
  }
  assert.deepEqual(workflowFloatingPanelPosition({ x: -200, y: 2000 }, panel, container, dock), { x: 14, y: 486, bottom: 14 });
});

test('only the near-edge threshold attracts an otherwise free position', () => {
  assert.equal(workflowFloatingPanelPosition({ x: 46, y: 180 }, panel, container, dock).x, 14);
  assert.equal(workflowFloatingPanelPosition({ x: 47, y: 180 }, panel, container, dock).x, 47);
  assert.equal(workflowFloatingPanelPosition({ x: 753, y: 180 }, panel, container, dock).x, 753);
  assert.equal(workflowFloatingPanelPosition({ x: 754, y: 180 }, panel, container, dock).x, 786);
});

test('small viewports reduce gutters without pushing the panel outside its available bounds', () => {
  assert.deepEqual(workflowFloatingPanelPosition({ x: 500, y: -10 }, { width: 378, height: 794 }, { width: 390, height: 806 }, { inset: 6, snapDistance: 32 }), { x: 6, y: 6, bottom: 6 });
  assert.deepEqual(workflowFloatingPanelPosition({ x: 80, y: 90 }, { width: 400, height: 500 }, { width: 320, height: 360 }, dock), { x: 0, y: 0, bottom: 0 });
  assert.deepEqual(workflowFloatingPanelPosition({ x: 80, y: 90 }, panel, { width: 405, height: 307 }, dock), { x: 2.5, y: 3.5, bottom: 3.5 });
});

test('overlapping snap regions select the closer edge deterministically', () => {
  const smallContainer = { width: 460, height: 360 };
  assert.equal(workflowFloatingPanelPosition({ x: 31, y: 30 }, panel, smallContainer, dock).x, 46);
  assert.equal(workflowFloatingPanelPosition({ x: 29, y: 30 }, panel, smallContainer, dock).x, 14);
  assert.equal(workflowFloatingPanelPosition({ x: 30, y: 30 }, panel, smallContainer, dock).x, 14);
});

test('unavailable or malformed geometry never persists nonfinite or negative positions', () => {
  assert.deepEqual(workflowFloatingPanelPosition({ x: NaN, y: Infinity }, panel, container, dock), { x: 14, y: 14, bottom: 486 });
  assert.deepEqual(workflowFloatingPanelPosition({ x: 30, y: 30 }, { width: -1, height: NaN }, { width: NaN, height: -1 }, { inset: Infinity, snapDistance: -1 }), { x: 0, y: 0, bottom: 0 });
});
