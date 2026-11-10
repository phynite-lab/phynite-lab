import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAgentFeatureFlags, aiAgentHumanError, aiAgentHumanErrors, aiAgentPresets, aiAgentStates, aiCampaignCandidateWithinContract, aiCampaignSummary, canAdvanceAiAgentState, validateAiAgentBudget, validateAiVisionEvidence } from '../lib/ai-agent-operator.ts';

test('agent feature flags are independently switchable', () => {
  const flags = aiAgentFeatureFlags({ PHYNITE_AI_AGENT_DISCOVERY: 'true', PHYNITE_AI_AGENT_VISION: '0' });
  assert.equal(flags['ai-agent-discovery'], true);
  assert.equal(flags['ai-agent-vision'], false);
  assert.deepEqual(aiAgentStates.slice(0, 5), ['planning', 'awaiting approval', 'executing', 'observing', 'validating']);
});

test('budget and campaign summaries keep researcher language', () => {
  assert.equal(validateAiAgentBudget({ maxWallSeconds: 3600, maxQueueWaitSeconds: 7200, agentLeaseTimeoutSeconds: 900, maxCandidates: 5, maxRepairs: 2, maxNodeHours: 10, maxSparseHarvestBytes: 256 * 1024 * 1024 }).maxQueueWaitSeconds, 7200);
  assert.throws(() => validateAiAgentBudget({ maxWallSeconds: 1, maxQueueWaitSeconds: 1, agentLeaseTimeoutSeconds: 1, maxCandidates: 6, maxRepairs: 1, maxSparseHarvestBytes: 1 }), /maksimal 5/);
  const contract = { maxCandidates: 5, parameterRanges: { kgrid: { min: 40, max: 80, unit: 'points' } }, evaluator: 'energy', allowedClusters: ['Mahameru'], totalNodeHours: 10, maxWallSecondsPerCandidate: 3600, repairPolicy: [], expiresAtEpoch: 4_000_000_000 } as const;
  assert.equal(aiCampaignCandidateWithinContract({ parameters: { kgrid: 60 }, cluster: 'Mahameru', nodeHours: 1 }, contract), true);
  assert.equal(aiCampaignCandidateWithinContract({ parameters: { kgrid: 90 }, cluster: 'Mahameru', nodeHours: 1 }, contract), false);
  const summary = aiCampaignSummary({ ...contract, clusterLabel: 'Mahameru' });
  assert.match(summary, /Maksimal 5 kandidat/);
  assert.doesNotMatch(summary, /profileSha256|payloadHash/);
});

test('state transitions and smart presets are bounded', () => {
  assert.equal(canAdvanceAiAgentState('observing', 'validating'), true);
  assert.equal(canAdvanceAiAgentState('completed', 'executing'), false);
  assert.equal(aiAgentPresets.length, 3);
  assert.equal(aiAgentPresets[0].contract.maxCandidates, 3);
});

test('human operator errors provide an action', () => {
  assert.deepEqual(aiAgentHumanError('SSH_DISCONNECTED').action, 'Sambung Ulang');
  assert.deepEqual(aiAgentHumanError('JOB_QUEUED').title, 'Job masih menunggu antrean');
  for (const error of Object.values(aiAgentHumanErrors)) {
    assert.doesNotMatch(`${error.title} ${error.message}`, /Traceback|pip install|payloadHash|profileSha256/i);
  }
});

test('vision evidence remains approximate and tied to an attachment checksum', () => {
  const evidence = validateAiVisionEvidence({ attachmentId: 'att-1', attachmentSha256: 'a'.repeat(64), page: 2, region: { x: 0, y: 0, width: 10, height: 10 }, confidence: .8, label: 'band gap label', approximate: true });
  assert.equal(evidence.approximate, true);
  assert.throws(() => validateAiVisionEvidence({ ...evidence, approximate: false as true }), /incomplete/);
});
