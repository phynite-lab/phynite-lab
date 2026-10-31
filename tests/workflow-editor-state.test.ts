import assert from 'node:assert/strict';
import test from 'node:test';
import { initialWorkflowEditorState as initial, workflowEditorReducer as reduce, workflowEditorTabs, workflowPaneTabs, workflowAiTab, restoreWorkflowEditor, workflowEditorSearch, workflowSplitTabs, workflowPreferredAiTab, workflowSplitPeer, isWorkflowLauncherTab, vacantWorkflowPosition, type WorkflowEditorState } from '../lib/workflow-editor-state.ts';
test('active editor closes to Canvas while closing an inactive editor preserves the current view', () => {
  let state = initial;
  for (const id of ['one', 'two', 'three', 'one']) state = reduce(state, { type: 'open', id });
  assert.deepEqual(state.tabs, ['one', 'two', 'three']); assert.equal(state.activeTab, 'one');
  assert.equal(reduce(state, { type: 'reorder', id: 'one', before: 'one' }), state);
  state = reduce(state, { type: 'close', id: 'three' }); assert.equal(state.activeTab, 'one');
  state = reduce({ ...state, layout: 'split' }, { type: 'close', id: 'one' });
  assert.equal(state.activeTab, 'canvas'); assert.equal(state.layout, 'full'); assert.deepEqual(state.tabs, ['two']);
  state = reduce(state, { type: 'open', id: 'two' });
  state = reduce(state, { type: 'reconcile', ids: [] }); assert.equal(state.activeTab, 'canvas');
});

test('Canvas is permanent, first and pinned, including restored old all-closed state and links', () => {
  const camera = { x: 12, y: 24, zoom: .75 };
  const state = reduce({ ...initial, viewport: camera }, { type: 'open', id: 'one' });
  assert.equal(reduce(state, { type: 'close', id: 'canvas' }), state);
  assert.equal(reduce(state, { type: 'pin', id: 'canvas' }), state);
  for (const search of ['', '?tab=', '?tab=canvas', '?tab=missing']) {
    const restored = restoreWorkflowEditor({ ...state, canvasClosed: true, activeTab: '', pinnedTabs: [] }, ['one'], search);
    assert.equal(restored.activeTab, 'canvas'); assert.equal(restored.canvasClosed, false);
    assert.equal(workflowEditorTabs(restored)[0], 'canvas'); assert.equal(restored.pinnedTabs?.[0], 'canvas');
    assert.deepEqual(restored.viewport, camera);
  }
  const duplicated = restoreWorkflowEditor({ tabs: ['canvas', 'one', 'canvas', 'one'], pinnedTabs: ['one', 'canvas'] }, ['one'], '');
  assert.deepEqual(workflowEditorTabs(duplicated), ['canvas', 'one']);
});

test('close all configurations preserves Canvas and camera, endpoint preferences and project history URL fields', () => {
  const viewport = { x: 15, y: 28, zoom: .7 }, edgeAnchors = { edge: { source: 'bottom' as const, target: 'top' as const } };
  let state = reduce({ ...initial, viewport, edgeAnchors, layout: 'split' }, { type: 'open', id: 'one' });
  state = reduce(reduce(state, { type: 'pin', id: 'one' }), { type: 'open', id: 'new:last' });
  const closed = reduce(state, { type: 'close-all' });
  assert.deepEqual(workflowEditorTabs(closed), ['canvas']); assert.deepEqual(closed.pinnedTabs, ['canvas']);
  assert.equal(closed.activeTab, 'canvas'); assert.equal(closed.layout, 'full');
  assert.deepEqual(closed.viewport, viewport); assert.deepEqual(closed.edgeAnchors, edgeAnchors);
  assert.equal(reduce(closed, { type: 'reconcile', ids: ['one'] }), closed);
  assert.equal(workflowEditorSearch('?popup=one&other=kept', closed), '?other=kept&layout=full');
  assert.deepEqual(workflowEditorTabs(restoreWorkflowEditor(closed, ['one'], '?tab=one')), ['canvas', 'one']);
  assert.deepEqual(workflowEditorTabs(reduce(reduce(closed, { type: 'open', id: 'new:last' }), { type: 'close', id: 'new:last' })), ['canvas']);
});

test('module pins follow permanent Canvas and survive restore, launcher resolution and closure', () => {
  let state = reduce(reduce(initial, { type: 'open', id: 'one' }), { type: 'open', id: 'two' });
  state = reduce(state, { type: 'pin', id: 'two' });
  assert.deepEqual(workflowEditorTabs(state), ['canvas', 'two', 'one']);
  assert.equal(reduce(state, { type: 'reorder', id: 'one', before: 'two' }), state);
  assert.deepEqual(restoreWorkflowEditor({ ...state, pinnedTabs: ['two', 'missing', 'two', false] }, ['one', 'two'], '?tab=one').pinnedTabs, ['canvas', 'two']);
  state = reduce(state, { type: 'close', id: 'two' }); assert.deepEqual(state.pinnedTabs, ['canvas']);
  state = reduce(reduce(state, { type: 'open', id: 'new:pin' }), { type: 'pin', id: 'new:pin' });
  state = reduce(state, { type: 'resolve-launcher', tabId: 'new:pin', nodeId: 'two' }); assert.deepEqual(state.pinnedTabs, ['canvas', 'two']);
  state = reduce(state, { type: 'reconcile', ids: ['one'] }); assert.deepEqual(state.pinnedTabs, ['canvas']);
  assert.equal(reduce(state, { type: 'pin', id: 'missing' }), state);
});
test('legacy popup and malformed cache restore safely and URL explicitly selects canvas', () => {
  const state = restoreWorkflowEditor({ tabs: ['one', 'one', 'missing'], activeTab: 'one', viewport: { x: 10, y: 20, zoom: .8 } }, ['one','two'], '?popup=two');
  assert.deepEqual(state.tabs, ['one','two']); assert.equal(state.activeTab, 'two');
  assert.equal(workflowEditorSearch('?popup=two&other=kept', state), '?other=kept&tab=two&layout=full');
  assert.equal(restoreWorkflowEditor({ tabs:['one'], activeTab:'one' }, ['one'], '?tab=canvas').activeTab, 'canvas');
  assert.equal(restoreWorkflowEditor('bad', [], '').activeTab, 'canvas');
  assert.equal(restoreWorkflowEditor({ viewport: { x:NaN,y:0,zoom:1 } }, [], '').viewport, undefined);
});
test('split, tool and camera remain local editor state and module placement avoids overlaps', () => {
  const state = reduce(reduce(initial, { type:'split',id:'one',beside:'canvas' }), { type:'tool', tool:'hand' });
  assert.equal(restoreWorkflowEditor(state, ['one'], '').layout, 'split'); assert.equal(state.tool, 'hand');
  assert.notDeepEqual(vacantWorkflowPosition([{ position: { x:0,y:0 } }], { x:0,y:0 }), { x:0,y:0 });
});
test('new tab launcher survives graph edits, reload and history without becoming a scientific node',()=>{
  const opened=reduce(initial,{type:'open',id:'new:one'});
  assert.deepEqual(reduce(opened,{type:'reconcile',ids:[]}),opened);
  const restored=restoreWorkflowEditor(opened,[],'?tab=new%3Aone');assert.equal(restored.activeTab,'new:one');
  assert.deepEqual(reduce(restored,{type:'resolve-launcher',tabId:'new:one',nodeId:'scf'}).tabs,['scf']);
  const two=reduce(reduce(opened,{type:'open',id:'scf'}),{type:'open',id:'new:two'});
  const resolved=reduce(two,{type:'resolve-launcher',tabId:'new:two',nodeId:'scf'});assert.deepEqual(resolved.tabs,['new:one','scf']);assert.equal(resolved.activeTab,'scf');
  assert.equal(reduce(reduce(initial,{type:'open',id:'new:one'}),{type:'close',id:'new:one'}).activeTab,'canvas');
});

test('connection endpoint placement stays local, survives tab edits and validates restored edge IDs', () => {
  const saved = reduce(initial, { type: 'edge-anchors', id: 'vertical', anchors: { source: 'bottom', target: 'top' } });
  assert.deepEqual(reduce(reduce(saved, { type: 'open', id: 'one' }), { type: 'close', id: 'one' }).edgeAnchors, saved.edgeAnchors);
  assert.deepEqual(reduce(saved, { type: 'reconcile', ids: [] }).edgeAnchors, saved.edgeAnchors);
  assert.deepEqual(restoreWorkflowEditor(saved, [], '', ['vertical']).edgeAnchors, saved.edgeAnchors);
  assert.equal(restoreWorkflowEditor(saved, [], '', []).edgeAnchors, undefined);
  assert.equal(workflowEditorSearch('', saved), '?layout=full');
  const malformed = { edgeAnchors: { valid: { source: 'right', target: 'top' }, swapped: { source: 'left', target: 'bottom' }, null: null, array: [], missing: { source: 'bottom' }, unknown: { source: 'bottom', target: 'top' } } };
  assert.deepEqual(restoreWorkflowEditor(malformed, [], '', ['valid', 'swapped', 'null', 'array', 'missing']).edgeAnchors, { valid: { source: 'right', target: 'top' } });
});

test('snapping preferences migrate defaults and remain local editor state', () => {
  const defaults=restoreWorkflowEditor(null,[], '');
  assert.equal(defaults.snapToGrid,true);assert.equal(defaults.showGuides,true);
  const changed=reduce(defaults,{type:'snapping',grid:false,guides:false});
  assert.equal(restoreWorkflowEditor(changed,[], '').snapToGrid,false);
  assert.equal(restoreWorkflowEditor(changed,[], '').showGuides,false);
  assert.equal(workflowEditorSearch('',changed),'?layout=full');
});

test('AI is a project UI tab and survives reconcile, reload, split, pin and launcher resolution', () => {
  let state = reduce(initial, { type: 'open', id: workflowAiTab });
  state = reduce(state, { type: 'layout', layout: 'split' });
  state = reduce(state, { type: 'pin', id: workflowAiTab });
  assert.equal(reduce(state, { type: 'reconcile', ids: [] }), state);
  const restored = restoreWorkflowEditor(state, [], workflowEditorSearch('', state));
  assert.equal(restored.activeTab, workflowAiTab);
  assert.equal(restored.layout, 'split');
  assert.deepEqual(restored.pinnedTabs, ['canvas', workflowAiTab]);
  const launcher = reduce(restored, { type: 'open', id: 'new:ai' });
  const resolved = reduce(launcher, { type: 'resolve-launcher', tabId: 'new:ai', nodeId: workflowAiTab });
  assert.deepEqual(resolved.tabs, [workflowAiTab]);
  const closed = reduce(resolved, { type: 'close', id: workflowAiTab });
  assert.equal(closed.activeTab, 'canvas');
  assert.equal(closed.layout, 'full');
});

test('arbitrary split pairs keep their positions on focus, replace only the focused pane and close safely', () => {
  let state = reduce(initial, { type: 'split', id: 'tool:ai:aic_abc', beside: 'scf', direction: 'left' });
  assert.deepEqual(workflowSplitTabs(state), ['tool:ai:aic_abc', 'scf']);
  state = reduce(state, { type: 'open', id: 'scf' });
  assert.deepEqual(workflowSplitTabs(state), ['tool:ai:aic_abc', 'scf']);
  const search = workflowEditorSearch('', state);
  assert.deepEqual(workflowSplitTabs(restoreWorkflowEditor(state, ['scf'], search)), state.splitTabs);
  assert.deepEqual(workflowSplitTabs(restoreWorkflowEditor(null, ['scf'], search)), state.splitTabs);
  state = reduce(state, { type: 'open', id: 'figure' });
  assert.deepEqual(workflowSplitTabs(state), ['tool:ai:aic_abc', 'figure']);
  state = reduce(state, { type: 'close', id: 'scf' });
  assert.equal(state.layout, 'split');
  state = reduce(state, { type: 'close', id: 'tool:ai:aic_abc' });
  assert.equal(state.activeTab, 'figure'); assert.equal(state.layout, 'full'); assert.equal(workflowSplitTabs(state), undefined);
  assert.equal(reduce(state, { type: 'split', id: 'figure', beside: 'figure' }), state);
});
test('removed split peers and malformed cached pairs never restore missing or duplicate editors', () => {
  const state = reduce(initial, { type: 'split', id: 'one', beside: 'two' });
  assert.equal(reduce(state, { type: 'reconcile', ids: ['one'] }).layout, 'full');
  for (const pair of [['one', 'one'], ['one', 'missing'], 'bad', [null, 'one']]) {
    const restored = restoreWorkflowEditor({ ...state, splitTabs: pair }, ['one'], '');
    assert.deepEqual(workflowSplitTabs(restored), ['one', 'canvas']);
  }
});

test('four split placements, swap, maximize and bookmark restore preserve arbitrary panes', () => {
  for (const direction of ['left', 'right', 'top', 'bottom'] as const) {
    let state = reduce(initial, { type: 'split', id: workflowAiTab, beside: 'scf', direction });
    assert.deepEqual(workflowSplitTabs(state), ['right', 'bottom'].includes(direction) ? ['scf', workflowAiTab] : [workflowAiTab, 'scf']);
    assert.equal(state.splitAxis, ['top', 'bottom'].includes(direction) ? 'vertical' : 'horizontal');
    const pair = state.splitTabs;
    state = reduce(state, { type: 'swap' }); assert.deepEqual(state.splitTabs, [...pair!].reverse());
    const maximized = reduce(state, { type: 'layout', layout: 'full' });
    assert.deepEqual(reduce(maximized, { type: 'layout', layout: 'split' }).splitTabs, state.splitTabs);
    const restored = restoreWorkflowEditor(state, ['scf'], workflowEditorSearch('', state));
    assert.deepEqual(restored.splitTabs, state.splitTabs); assert.equal(restored.splitAxis, state.splitAxis);
  }
});
test('floating and minimized chat keep conversation identity, camera and drafts independent of pane focus', () => {
  const viewport = { x: 5, y: 10, zoom: .7 };
  let state = reduce({ ...initial, viewport }, { type: 'open', id: workflowAiTab });
  for (const presentation of ['floating', 'composer'] as const) {
    state = reduce(state, { type: 'ai-presentation', id: workflowAiTab, presentation });
    assert.equal(state.activeTab, 'canvas'); assert.equal(state.aiPanel?.presentation, presentation);
    assert.deepEqual(state.tabs, [workflowAiTab]); assert.equal(state.viewport, viewport);
    assert.equal(restoreWorkflowEditor(state, [], '').aiPanel?.presentation, presentation);
  }
  const besideModule = reduce(initial, { type: 'split', id: workflowAiTab, beside: 'scf', direction: 'right' });
  assert.equal(reduce(besideModule, { type: 'ai-presentation', id: workflowAiTab, presentation: 'composer' }).activeTab, 'scf');
  assert.equal(reduce(state, { type: 'open', id: workflowAiTab }).aiPanel, undefined);
  assert.equal(reduce(state, { type: 'close', id: workflowAiTab }).aiPanel, undefined);
  assert.equal(restoreWorkflowEditor({ ...state, aiPanel: { id: 'foreign', presentation: 'floating' } }, [], '').aiPanel, undefined);
});

test('opening another view automatically docks the current chat without altering its camera or explicit splits', () => {
  const chat = 'tool:ai:aic_first', other = 'tool:ai:aic_second';
  const viewport = { x: 20, y: -40, zoom: .8 };
  const full = reduce({ ...initial, viewport }, { type: 'open', id: chat });
  const moduleView = reduce(full, { type: 'open', id: 'scf' });
  assert.deepEqual(moduleView.aiPanel, { id: chat, presentation: 'composer' });
  assert.equal(moduleView.activeTab, 'scf'); assert.equal(moduleView.viewport, viewport);
  const floating = reduce(moduleView, { type: 'ai-presentation', id: chat, presentation: 'floating' });
  const sized = reduce(reduce(floating, { type: 'panel-size', width: 560, height: 480 }), { type: 'panel-position', x: 90, y: 70 });
  const docked = reduce(sized, { type: 'open', id: 'bands' });
  assert.equal(docked.aiPanel?.presentation, 'composer'); assert.equal(docked.aiPanel?.width, 560);
  assert.deepEqual(restoreWorkflowEditor(docked, ['scf', 'bands'], '').aiPanel, docked.aiPanel);
  assert.equal(restoreWorkflowEditor(docked, ['scf', 'bands'], `?tab=${chat}`).aiPanel, undefined);
  const switched = reduce(docked, { type: 'ai-presentation', id: other, presentation: 'floating' });
  assert.equal(switched.activeTab, 'bands'); assert.ok(switched.tabs.includes(other));
  assert.equal(switched.aiPanel?.width, 560); assert.equal(switched.aiPanel?.id, other);
  const split = reduce(full, { type: 'split', id: chat, beside: 'scf' });
  assert.equal(reduce(split, { type: 'open', id: 'scf' }).aiPanel, undefined);
  assert.deepEqual(reduce(split, { type: 'open', id: 'scf' }).splitTabs, split.splitTabs);
  assert.equal(reduce(split, { type: 'open', id: 'bands' }).aiPanel, undefined);
  assert.deepEqual(reduce(split, {type:'open',id:'bands'}).splitTabs,['bands',chat]);
  assert.equal(reduce(sized, { type: 'panel-size', width: NaN, height: 400 }), sized);
  assert.equal(reduce(sized, { type: 'panel-position', x: Infinity, y: 0 }), sized);
});

test('Canvas focus hides views without losing their layout, camera or floating chat', () => {
  const split = reduce({ ...initial, viewport: { x: 7, y: 8, zoom: .6 } }, { type: 'split', id: 'tool:ai:aic_focus', beside: 'scf' });
  const hidden = reduce(split, { type: 'tabs-hidden', hidden: true });
  assert.equal(hidden.tabsHidden, true); assert.equal(hidden.activeTab, split.activeTab);
  assert.equal(hidden.viewport, split.viewport); assert.equal(hidden.splitTabs, split.splitTabs);
  assert.equal(restoreWorkflowEditor(hidden, ['scf'], workflowEditorSearch('', hidden)).tabsHidden, true);
  assert.equal(reduce(hidden, { type: 'tabs-hidden', hidden: false }).layout, 'split');
  assert.equal(reduce(hidden, { type: 'open', id: 'scf' }).tabsHidden, false);
  assert.equal(reduce(hidden, { type: 'ai-presentation', id: 'tool:ai:aic_focus', presentation: 'floating' }).tabsHidden, false);
});


test('pane tab ownership survives focus changes, reload and swapping', () => {
  let state = reduce(initial, { type: 'split', id: 'right', beside: 'left', direction: 'right' });
  state = reduce(state, { type: 'open', id: 'left-two', pane: 0 });
  state = reduce(state, { type: 'open', id: 'right-two', pane: 1 });
  assert.deepEqual(workflowSplitTabs(state), ['left-two', 'right-two']);
  state = reduce(state, { type: 'open', id: 'left' });
  assert.deepEqual(workflowSplitTabs(state), ['left', 'right-two']);
  assert.deepEqual(workflowPaneTabs(state), [['canvas', 'left', 'left-two'], ['right', 'right-two']]);
  const restored = restoreWorkflowEditor(state, ['left', 'right', 'left-two', 'right-two'], workflowEditorSearch('', state));
  assert.deepEqual(workflowPaneTabs(restored), workflowPaneTabs(state));
  const swapped = reduce(restored, { type: 'swap' });
  assert.deepEqual(workflowPaneTabs(swapped), [...workflowPaneTabs(state)].reverse());
  assert.deepEqual(workflowSplitTabs(swapped), ['right-two', 'left']);
});

test('pane add, hide, close and selecting a peer never discard the sibling pane', () => {
  let state = reduce(initial, { type: 'split', id: 'right', beside: 'left', direction: 'right' });
  state = reduce(state, { type: 'open', id: 'new:secondary', pane: 1 });
  assert.deepEqual(workflowSplitTabs(state), ['left', 'new:secondary']);
  state = reduce(state, { type: 'resolve-launcher', tabId: 'new:secondary', nodeId: 'right-two' });
  assert.deepEqual(workflowSplitTabs(state), ['left', 'right-two']);
  assert.deepEqual(workflowPaneTabs(state)[1], ['right', 'right-two']);
  state = reduce(state, { type: 'pane-tabs-hidden', pane: 1, hidden: true });
  assert.deepEqual(state.paneTabsHidden, [false, true]);
  assert.deepEqual(workflowSplitTabs(state), ['left', 'right-two']);
  state = reduce(state, { type: 'close', id: 'right-two' });
  assert.deepEqual(workflowSplitTabs(state), ['left', 'right']);
  state = reduce(state, { type: 'open', id: 'left', pane: 1 });
  assert.deepEqual(workflowSplitTabs(state), ['right', 'left']);
  assert.deepEqual(workflowPaneTabs(state)[1], ['left']);
});

test('restored pane assignments reject stale or malformed entries', () => {
  const restored = restoreWorkflowEditor({ tabs: ['left', 'right'], activeTab: 'left', layout: 'split', splitTabs: ['left', 'right'], tabPanes: { left: 1, right: 0, stale: 1, canvas: 4 }, paneTabsHidden: ['yes', true] }, ['left', 'right'], '');
  assert.deepEqual(workflowPaneTabs(restored), [['canvas', 'left'], ['right']]);
  assert.deepEqual(restored.paneTabsHidden, [false, true]);
  assert.equal(restored.tabPanes?.stale, undefined);
});


test('resolving a pane launcher to an existing peer swaps editors without duplicate pane IDs', () => {
  let state = reduce(initial, {type:'split',id:'right',beside:'left',direction:'right'});
  state = reduce(state, {type:'open',id:'new:peer',pane:1});
  state = reduce(state, {type:'resolve-launcher',tabId:'new:peer',nodeId:'left'});
  assert.deepEqual(workflowSplitTabs(state), ['right','left']);
  assert.equal(state.tabs.includes('new:peer'), false);
  assert.deepEqual(workflowPaneTabs(state), [['canvas','right'],['left']]);
});


test('floating chat outside clicks preserve an independent module split', () => {
  let state = reduce(initial, {type:'split',id:'right',beside:'left',direction:'right'});
  state = reduce(state, {type:'ai-presentation',id:workflowAiTab,presentation:'floating'});
  assert.deepEqual(workflowSplitTabs(state), ['left','right']);
  state = reduce(state, {type:'ai-presentation',id:workflowAiTab,presentation:'composer'});
  assert.deepEqual(workflowSplitTabs(state), ['left','right']);
});


test('direct split remembers chat/module, maximizes atomically and restores ratio, axis and peer after reload', () => {
  const chat = 'tool:ai:aic_reference';
  let state = reduce(reduce(initial, {type:'open',id:'scf'}), {type:'open',id:chat});
  state = reduce(state, {type:'toggle-split'});
  assert.deepEqual(state.splitTabs, ['scf', chat]);
  state = reduce(reduce(state,{type:'ratio',ratio:.43}),{type:'axis',axis:'vertical'});
  const full = reduce(state,{type:'maximize',id:'scf'});
  assert.equal(full.layout,'full'); assert.equal(full.activeTab,'scf'); assert.equal(full.aiPanel?.presentation,'composer');
  const reloaded = restoreWorkflowEditor(full,['scf','bands'],workflowEditorSearch('',full));
  const restored = reduce(reloaded,{type:'toggle-split'});
  assert.deepEqual(restored.splitTabs,['scf',chat]); assert.equal(restored.splitRatio,.43); assert.equal(restored.splitAxis,'vertical'); assert.equal(restored.aiPanel,undefined);
  const third = reduce(reduce(full,{type:'open',id:'bands'}),{type:'toggle-split'});
  assert.deepEqual(third.splitTabs,['bands',chat]); assert.equal(third.activeTab,'bands');
  assert.equal(reduce(state,{type:'maximize',id:chat}).aiPanel,undefined);
  assert.equal(restoreWorkflowEditor(state,['scf'],workflowEditorSearch('',full)).layout,'full');
});
test('latest revisited tabs determine initial pair; legacy thin modes migrate to complete composer', () => {
  const a='tool:ai:aic_a',b='tool:ai:aic_b';
  let state=reduce(reduce(reduce(initial,{type:'open',id:a}),{type:'open',id:b}),{type:'open',id:a});
  state=reduce(state,{type:'open',id:'scf'});
  assert.deepEqual(reduce(state,{type:'toggle-split'}).splitTabs,['scf',a]);
  assert.equal(restoreWorkflowEditor({...state,aiPanel:{id:a,presentation:'compact'}},['scf'],'').aiPanel?.presentation,'composer');
  assert.equal(restoreWorkflowEditor({...state,aiPanel:{id:a,presentation:'minimized'}},['scf'],'').aiPanel?.presentation,'minimized');
  assert.equal(reduce(initial,{type:'toggle-split'}),initial);
  const modules=reduce(initial,{type:'split',id:'scf',beside:'bands'});
  assert.deepEqual(reduce(reduce(modules,{type:'maximize',id:'bands'}),{type:'toggle-split'}).splitTabs,modules.splitTabs);
});

test('history explicitly restores Canvas peer, horizontal axis and embedded chat without a duplicate floating view', () => {
  const chat='tool:ai:aic_history';
  const original=reduce(initial,{type:'split',id:chat,beside:'canvas'}), search=workflowEditorSearch('',original);
  const later=reduce(reduce(original,{type:'split',id:chat,beside:'scf'}),{type:'axis',axis:'vertical'});
  const full=reduce(later,{type:'maximize',id:'scf'});
  const restored=reduce(full,{type:'restore',state:restoreWorkflowEditor(full,['scf'],search)});
  assert.deepEqual(restored.splitTabs,['canvas',chat]);assert.equal(restored.splitAxis,'horizontal');assert.equal(restored.aiPanel,undefined);
  assert.equal(reduce(restored,{type:'toggle-split',id:'missing'}),restored);
  const other=reduce(reduce(full,{type:'open',id:chat}),{type:'open',id:'tool:ai:aic_other'});
  assert.equal(other.aiPanel,undefined);
});

test('restoring modules and a swapped Canvas replaces only the remembered workspace slot', () => {
  let modules=reduce(initial,{type:'split',id:'left',beside:'right'});
  modules=reduce(modules,{type:'open',id:'right-two',pane:1});
  modules=reduce(modules,{type:'open',id:'right',pane:1});
  modules=reduce(reduce(modules,{type:'maximize',id:'right'}),{type:'open',id:'right-two'});
  assert.deepEqual(reduce(modules,{type:'toggle-split'}).splitTabs,['left','right-two']);
  const chat='tool:ai:aic_swapped';
  const swapped=reduce(initial,{type:'split',id:'canvas',beside:chat});
  const full=reduce(reduce(swapped,{type:'maximize',id:'canvas'}),{type:'open',id:'scf'});
  assert.deepEqual(reduce(full,{type:'toggle-split'}).splitTabs,['scf',chat]);
});

test('closing an inactive remembered peer in full view cannot reopen it on reload', () => {
  const chat='tool:ai:aic_closed';
  const split=reduce(initial,{type:'split',id:chat,beside:'scf'});
  const closed=reduce(reduce(split,{type:'maximize',id:chat}),{type:'close',id:'scf'});
  assert.equal(closed.splitTabs,undefined);
  assert.deepEqual(restoreWorkflowEditor(closed,['scf'],workflowEditorSearch('',closed)).tabs,[chat]);
});

test('history back to a full chat clears another conversation composer',()=>{
  const a='tool:ai:aic_earlier',b='tool:ai:aic_later';
  const earlier=reduce(initial,{type:'open',id:a});
  const later=reduce(reduce(earlier,{type:'open',id:b}),{type:'open',id:'scf'});
  const restored=reduce(later,{type:'restore',state:restoreWorkflowEditor(later,['scf'],workflowEditorSearch('',earlier))});
  assert.equal(restored.activeTab,a);assert.equal(restored.aiPanel,undefined);
});

test('chat/module split puts module tabs together and sidebar module navigation keeps the chat peer',()=>{
  const chat='tool:ai:aic_modulebar';
  let state=reduce(reduce(reduce(initial,{type:'open',id:'scf'}),{type:'open',id:'bands'}),{type:'open',id:chat});
  state=reduce(state,{type:'toggle-split'});
  assert.deepEqual(workflowPaneTabs(state)[0],['canvas','scf','bands']);
  state=reduce(state,{type:'open',id:'dos'});
  assert.deepEqual(state.splitTabs,['dos',chat]);assert.equal(state.aiPanel,undefined);
});

test('legacy chat-first panes migrate once, preserving chat width, focus, membership and hidden tabs',()=>{
  const chat='tool:ai:aic_legacyright';
  const legacy={...initial,paneOrderVersion:undefined,tabs:[chat,'scf','bands'],activeTab:'scf',layout:'split' as const,splitTabs:[chat,'scf'],splitRatio:.4,tabPanes:{canvas:0,[chat]:0,scf:1,bands:1},paneTabsHidden:[true,false]};
  const restored=restoreWorkflowEditor(legacy,['scf','bands'],`?tab=scf&layout=split&beside=${chat}&side=right&axis=horizontal`);
  assert.deepEqual(restored.splitTabs,['scf',chat]);assert.equal(restored.splitRatio,.6);assert.equal(restored.activeTab,'scf');
  assert.deepEqual(restored.paneTabsHidden,[false,true]);assert.deepEqual(workflowPaneTabs(restored),[['canvas','scf','bands'],[chat]]);
  assert.equal(restored.paneOrderVersion,1);
  const again=restoreWorkflowEditor(restored,['scf','bands'],workflowEditorSearch('',restored));
  assert.deepEqual(again.splitTabs,restored.splitTabs);assert.equal(again.splitRatio,.6);
  const explicit=reduce(again,{type:'split',id:chat,beside:'scf',direction:'left'});
  assert.deepEqual(restoreWorkflowEditor(explicit,['scf','bands'],workflowEditorSearch('',explicit)).splitTabs,[chat,'scf']);
  const remembered=restoreWorkflowEditor({...legacy,layout:'full'},['scf','bands'],'?tab=scf&layout=full');
  assert.deepEqual(reduce(remembered,{type:'toggle-split'}).splitTabs,['scf',chat]);
});

test('repeated new-tab actions reuse the pane launcher while preserving its sibling and saved geometry', () => {
  let state = reduce(initial, { type: 'split', id: 'right', beside: 'left', direction: 'right' });
  state = reduce(state, { type: 'ratio', ratio: .42 });
  state = reduce(state, { type: 'open', id: 'new:right', pane: 1 });
  state = reduce(state, { type: 'open', id: 'new:left', pane: 0 });
  for (let index = 0; index < 4; index++) {
    state = reduce(state, { type: 'open', id: `new:extra${index}`, pane: 1 });
    assert.equal(state.activeTab, 'new:right');
    assert.deepEqual(state.splitTabs, ['new:left', 'new:right']);
    assert.deepEqual(state.tabs.filter(isWorkflowLauncherTab), ['new:right', 'new:left']);
    assert.equal(state.splitRatio, .42);
  }
  state = reduce(state, { type: 'open', id: 'right', pane: 1 });
  state = reduce(state, { type: 'open', id: 'new:again', pane: 1 });
  assert.deepEqual(state.splitTabs, ['new:left', 'new:right']);
  const restored = restoreWorkflowEditor(state, ['left', 'right'], workflowEditorSearch('', state));
  assert.deepEqual(restored.splitTabs, state.splitTabs);
  assert.deepEqual(workflowPaneTabs(restored), workflowPaneTabs(state));
});

test('full view reuses an existing launcher instead of accumulating empty tabs', () => {
  let state = reduce(initial, { type: 'open', id: 'new:first' });
  state = reduce(state, { type: 'open', id: 'scf' });
  state = reduce(state, { type: 'open', id: 'new:second' });
  assert.equal(state.activeTab, 'new:first');
  assert.deepEqual(state.tabs, ['new:first', 'scf']);
  state = reduce(state, { type: 'resolve-launcher', tabId: 'new:first', nodeId: 'bands' });
  state = reduce(state, { type: 'open', id: 'new:third' });
  assert.deepEqual(state.tabs, ['bands', 'scf', 'new:third']);
});

test('legacy launchers normalize per pane and remap selected split IDs before restoring the view', () => {
  const raw: WorkflowEditorState = { ...initial, tabs: ['scf', 'bands', 'new:leftold', 'new:rightold', 'new:leftlatest', 'new:rightlatest'], activeTab: 'scf', layout: 'split', splitTabs: ['scf', 'new:rightold'], tabPanes: { 'new:leftold': 0, 'new:leftlatest': 0, 'new:rightold': 1, 'new:rightlatest': 1 }, pinnedTabs: ['canvas', 'new:rightold'], viewport: { x: 8, y: -12, zoom: .75 }, splitRatio: .4 };
  for (const state of [restoreWorkflowEditor(raw, ['scf', 'bands'], ''), reduce(initial, { type: 'restore', state: raw })]) {
    assert.deepEqual(state.tabs, ['scf', 'bands', 'new:leftlatest', 'new:rightlatest']);
    assert.deepEqual(state.splitTabs, ['scf', 'new:rightlatest']);
    assert.equal(state.activeTab, 'scf');
    assert.deepEqual(state.pinnedTabs, ['canvas', 'new:rightlatest']);
    assert.deepEqual(state.viewport, raw.viewport);
    assert.equal(state.splitRatio, .4);
    assert.equal(state.tabPanes?.['new:rightold'], undefined);
    assert.deepEqual(workflowPaneTabs(state)[1], ['new:rightlatest']);
    const reloaded = restoreWorkflowEditor(state, ['scf', 'bands'], workflowEditorSearch('', state));
    assert.deepEqual(reloaded.tabs, state.tabs);
    assert.deepEqual(reloaded.splitTabs, state.splitTabs);
    assert.deepEqual(reloaded.tabPanes, state.tabPanes);
    assert.equal(reloaded.activeTab, state.activeTab);
  }
});

test('the active legacy launcher wins over later duplicates, including a history-selected launcher', () => {
  const raw: WorkflowEditorState = { ...initial, tabs: ['scf', 'new:active', 'new:last'], activeTab: 'new:last', layout: 'split', splitTabs: ['scf', 'new:active'], tabPanes: { 'new:active': 1, 'new:last': 1 } };
  const state = restoreWorkflowEditor(raw, ['scf'], '?tab=new%3Aactive&layout=split&beside=scf&side=right');
  assert.equal(state.activeTab, 'new:active');
  assert.deepEqual(state.tabs, ['scf', 'new:active']);
  assert.deepEqual(workflowSplitTabs(state), ['scf', 'new:active']);
  const latest = restoreWorkflowEditor(raw, ['scf'], '');
  assert.equal(latest.activeTab, 'new:last');
  assert.deepEqual(workflowSplitTabs(latest), ['scf', 'new:last']);
});

test('preferred AI follows the active, floating or latest revisited conversation, leaving catalog fallback explicit', () => {
  const a = 'tool:ai:aic_a', b = 'tool:ai:aic_b';
  let state = initial;
  for (const id of [a, b, a, 'scf']) state = reduce(state, { type: 'open', id });
  assert.equal(workflowPreferredAiTab(state), a);
  assert.equal(workflowPreferredAiTab({ ...state, activeTab: b }), b);
  assert.equal(workflowPreferredAiTab({ ...state, aiPanel: { id: b, presentation: 'floating' } }), b);
  assert.equal(workflowPreferredAiTab({ ...state, aiPanel: undefined }), a);
  assert.equal(workflowPreferredAiTab({ ...state, activeTab: workflowAiTab, aiPanel: { id: 'tool:ai:aic_missing', presentation: 'composer' }, lastChat: workflowAiTab }), undefined);
  assert.equal(workflowPreferredAiTab({ ...initial, tabs: [a, b] }), undefined);
});

test('split placement retains the current or remembered peer for every direction and pane focus', () => {
  const chat = 'tool:ai:aic_peer';
  for (const [left, right] of [['scf', chat], ['scf', 'bands']]) {
    let state = reduce(initial, { type: 'split', id: right, beside: left, direction: 'right' });
    for (const focused of [left, right]) {
      state = reduce(state, { type: 'open', id: focused });
      const peer = focused === left ? right : left;
      assert.equal(workflowSplitPeer(state, focused), peer);
      const full = reduce(state, { type: 'maximize', id: focused });
      assert.equal(workflowSplitPeer(full, focused), peer);
      for (const direction of ['left', 'right', 'top', 'bottom'] as const) {
        const placed = reduce(state, { type: 'split', id: focused, beside: workflowSplitPeer(state, focused)!, direction });
        assert.deepEqual(new Set(placed.splitTabs), new Set([left, right]));
        assert.equal(placed.splitAxis, direction === 'top' || direction === 'bottom' ? 'vertical' : 'horizontal');
      }
    }
  }
});

test('split peer fallback uses an available workspace or preferred conversation and ignores launchers and stale IDs', () => {
  const chat = 'tool:ai:aic_fallback';
  const full = reduce(reduce(initial, { type: 'open', id: 'scf' }), { type: 'open', id: chat });
  assert.equal(workflowSplitPeer(full, chat), 'scf');
  const moduleView = reduce(full, { type: 'open', id: 'scf' });
  assert.equal(workflowSplitPeer(moduleView, 'scf'), chat);
  const fallback = { ...moduleView, aiPanel: undefined, lastChat: 'tool:ai:aic_missing', lastModule: 'missing', tabs: ['scf', 'new:empty'], splitTabs: ['scf', 'missing'] as [string, string] };
  assert.equal(workflowSplitPeer(fallback, 'scf'), 'canvas');
  assert.equal(workflowSplitPeer(fallback, 'new:empty'), undefined);
  assert.equal(workflowSplitPeer(fallback, 'missing'), undefined);
  assert.equal(workflowSplitPeer(initial, 'canvas'), undefined);
});

test('responsive floating geometry can update without changing the saved split or creating a floating state', () => {
  const split = reduce(initial, { type: 'split', id: 'scf', beside: 'tool:ai:aic_responsive' });
  const moved = reduce(split, { type: 'panel-position', x: 80, y: 120, bottom: 24 });
  const sized = reduce(moved, { type: 'panel-size', width: 720, height: 480 });
  assert.equal(sized.aiPanel, undefined);
  assert.deepEqual(sized.aiPanelBounds, { x: 80, y: 120, bottom: 24, width: 720, height: 480 });
  assert.equal(sized.layout, 'split');
  assert.equal(sized.activeTab, 'scf');
  assert.equal(sized.splitTabs, split.splitTabs);
  assert.deepEqual(restoreWorkflowEditor(sized, ['scf'], workflowEditorSearch('', sized)).aiPanelBounds, sized.aiPanelBounds);
  const floating = reduce(sized, { type: 'maximize', id: 'scf' });
  assert.deepEqual(floating.aiPanel, { ...sized.aiPanelBounds, id: 'tool:ai:aic_responsive', presentation: 'composer' });
  assert.equal(reduce(split, { type: 'panel-position', x: NaN, y: 0 }), split);
  assert.equal(reduce(split, { type: 'panel-size', width: Infinity, height: 480 }), split);
  assert.deepEqual(reduce(split, { type: 'panel-size', width: 12, height: 5000 }).aiPanelBounds, { width: 320, height: 1400 });
});

test('explicit split and floating actions remember the selected conversation for later reopening', () => {
  const a = 'tool:ai:aic_earlier', b = 'tool:ai:aic_selected';
  let state = reduce(initial, { type: 'open', id: a });
  state = reduce(state, { type: 'split', id: 'scf', beside: b });
  assert.equal(workflowPreferredAiTab(state), b);
  state = reduce(state, { type: 'maximize', id: 'scf' });
  assert.equal(state.lastChat, b);
  state = reduce(state, { type: 'ai-presentation', id: a, presentation: 'floating' });
  assert.equal(state.lastChat, a);
  assert.equal(workflowPreferredAiTab(state), a);
});

test('edge full view and reload retain the original split pair, axis and wide-screen ratios', () => {
  for (const axis of ['horizontal', 'vertical'] as const) for (const ratio of [.15, .18, .82, .85]) for (const focused of ['left', 'right']) {
    let state = reduce(initial, { type: 'split', id: 'left', beside: 'right' });
    state = reduce(state, { type: 'axis', axis }); state = reduce(state, { type: 'ratio', ratio });
    const pair = state.splitTabs;
    state = reduce(state, { type: 'maximize', id: focused });
    assert.equal(state.layout, 'full'); assert.equal(state.activeTab, focused);
    state = restoreWorkflowEditor(state, ['left', 'right'], workflowEditorSearch('', state));
    state = reduce(state, { type: 'toggle-split', id: focused });
    assert.equal(state.layout, 'split'); assert.equal(state.splitRatio, ratio);
    assert.equal(state.splitAxis, axis); assert.deepEqual(state.splitTabs, pair);
  }
});


test('icon minimize survives module navigation and reload without changing floating bounds', () => {
  const id = 'tool:ai:aic_tiny';
  let state = reduce(initial, { type: 'ai-presentation', id, presentation: 'floating' });
  state = reduce(state, { type: 'panel-size', width: 760, height: 620 });
  state = reduce(state, { type: 'panel-position', x: 40, y: 60, bottom: 24 });
  state = reduce(state, { type: 'ai-presentation', id, presentation: 'minimized' });
  state = reduce(state, { type: 'open', id: 'scf' });
  assert.equal(state.aiPanel?.presentation, 'minimized');
  const restored = restoreWorkflowEditor(state, ['scf'], workflowEditorSearch('', state));
  assert.deepEqual(restored.aiPanel, state.aiPanel);
  const expanded = reduce(restored, { type: 'ai-presentation', id, presentation: 'floating' });
  assert.equal(expanded.aiPanel?.width, 760); assert.equal(expanded.aiPanel?.height, 620);
  assert.equal(expanded.activeTab, 'scf');
});
