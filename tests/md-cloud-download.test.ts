import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadMdCloudFile } from '../lib/md-cloud-download.ts';
import { PhyniteApiError } from '../lib/phynite-api.ts';

const sourceUrl = '/api/cloud-artifacts/MD_TRAJECTORY/trajectory-fixture?path=source';

test('MD source downloads keep the authenticated route and exact binary bytes', async () => {
  const bytes = new Uint8Array([0, 255, 10, 13, 128]);
  const signal = new AbortController().signal;
  const calls: unknown[] = [];
  const file = await downloadMdCloudFile(sourceUrl, {
    signal,
    fetch: async (url, init) => {
      calls.push(url);
      assert.equal(init?.signal, signal);
      assert.equal(init?.credentials, 'same-origin');
      return new Response(bytes);
    },
  });
  assert.deepEqual(calls, [sourceUrl]);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test('legacy signed S3 sources use the same-origin proxy without a browser S3 request', async () => {
  const url = 'https://bucket.s3.ap-southeast-1.amazonaws.com/source?X-Amz-Signature=fixture';
  const calls: unknown[] = [];
  await downloadMdCloudFile(url, { fetch: async value => {
    calls.push(value);
    return new Response('fixture');
  } });
  assert.deepEqual(calls, [`/api/md-cloud-download?url=${encodeURIComponent(url)}`]);
});

test('missing MD download routes are distinguished from deleted source files', async () => {
  for (const code of ['NOT_FOUND', 'ARTIFACT_NOT_FOUND']) {
    let calls = 0;
    await assert.rejects(downloadMdCloudFile(sourceUrl, { fetch: async () => {
      calls++;
      return Response.json({ error: code === 'NOT_FOUND' ? 'API route was not found.' : 'Artifact was not found.', code }, { status: 404 });
    } }), (error: unknown) => {
      assert.ok(error instanceof PhyniteApiError);
      assert.equal(error.code, code);
      assert.match(error.message, code === 'NOT_FOUND' ? /update the MD download service/ : /Artifact was not found/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('MD download errors preserve authentication, expiration and allocation diagnostics without retrying', async () => {
  for (const status of [401, 410, 429]) {
    let calls = 0;
    await assert.rejects(downloadMdCloudFile(sourceUrl, { fetch: async () => {
      calls++;
      return Response.json({ error: 'Actionable backend detail.', code: `ERROR_${status}` }, { status });
    } }), (error: unknown) => {
      assert.ok(error instanceof PhyniteApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, `ERROR_${status}`);
      assert.equal(error.message, 'Actionable backend detail.');
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('MD download cancellation does not start a second download', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(downloadMdCloudFile(sourceUrl, {
    signal: controller.signal,
    fetch: async (_url, init) => {
      calls++;
      throw init?.signal?.reason;
    },
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('MD downloads reject arbitrary external addresses before making a request', async () => {
  for (const url of ['https://untrusted.example/file', '//untrusted.example/file', '/api/\\untrusted.example/file']) {
    await assert.rejects(downloadMdCloudFile(url, { fetch: async () => {
      assert.fail('Invalid addresses must not be fetched.');
    } }), /download address is invalid/);
  }
});
