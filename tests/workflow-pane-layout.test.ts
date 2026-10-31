import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowPaneDrag, workflowPaneGeometry } from '../lib/workflow-pane-layout.ts';

test('stacked split reserves the second header and divider before sizing content', () => {
  const exact = workflowPaneGeometry(800, 525, 'vertical', .65);
  assert.equal(exact.available, true);
  assert.equal(exact.extent, 480);
  assert.equal(exact.primary, 240);
  assert.equal(workflowPaneGeometry(800, 524, 'vertical', .65).available, false);
});
test('both panes retain their content minimum as ratios and orientation change', () => {
  for (const axis of ['horizontal', 'vertical'] as const) for (const ratio of [.2, .5, .8]) {
    const result = workflowPaneGeometry(1200, 800, axis, ratio);
    assert.ok(result.primary >= result.minimum);
    assert.ok(result.extent - result.primary >= result.minimum);
    assert.equal(result.extent + 1 + (axis === 'vertical' ? 44 : 0), axis === 'vertical' ? 800 : 1200);
  }
});
test('narrow screens fall back without a negative content extent', () => {
  assert.equal(workflowPaneGeometry(720, 800, 'horizontal', .5).available, false);
  assert.equal(workflowPaneGeometry(721, 800, 'horizontal', .5).available, true);
  assert.deepEqual(workflowPaneGeometry(320, 0, 'vertical', .5), { minimum: 240, extent: 0, available: false, primary: 0 });
});

test('drag clamps at each minimum and requires a deliberate overshoot before full view', () => {
  for (const axis of ['horizontal', 'vertical'] as const) {
    const geometry = workflowPaneGeometry(2001, 1645, axis, .5), { minimum, extent } = geometry;
    assert.deepEqual(workflowPaneDrag(geometry, minimum - 63), { primary: minimum, ratio: minimum / extent, maximizePane: undefined });
    assert.equal(workflowPaneDrag(geometry, minimum - 64).maximizePane, 1);
    assert.deepEqual(workflowPaneDrag(geometry, extent - minimum + 63), { primary: extent - minimum, ratio: (extent - minimum) / extent, maximizePane: undefined });
    assert.equal(workflowPaneDrag(geometry, extent - minimum + 64).maximizePane, 0);
    assert.equal(workflowPaneDrag(geometry, extent * .5).maximizePane, undefined);
  }
});
