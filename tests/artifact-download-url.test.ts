import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactDownloadUrl } from '../lib/artifact-download-url.ts';
test('artifact downloads accept signed regional/global S3 REST URLs', () => {
  for (const host of ['bucket.s3.ap-southeast-1.amazonaws.com', 's3.amazonaws.com', 'bucket.s3-us-west-2.amazonaws.com']) {
    assert.ok(artifactDownloadUrl(`https://${host}/file.xyz?X-Amz-Signature=fixture`));
  }
  assert.ok(artifactDownloadUrl('https://bucket.s3.amazonaws.com/file?Signature=fixture'));
});
test('artifact proxy rejects arbitrary AWS services, unsafe schemes and forged host suffixes', () => {
  for (const value of ['http://bucket.s3.amazonaws.com/file?Signature=fixture', 'https://lambda.amazonaws.com/file?Signature=fixture', 'https://bucket.s3.amazonaws.com.evil.test/file?Signature=fixture', 'https://bucket.s3-website.ap-southeast-1.amazonaws.com/file?Signature=fixture', 'https://user:password@bucket.s3.amazonaws.com/file?Signature=fixture', 'https://bucket.s3.amazonaws.com/file', 'https://127.0.0.1/file?Signature=fixture']) assert.equal(artifactDownloadUrl(value), null);
  assert.equal(artifactDownloadUrl('http://127.0.0.1:8791/file', true),null);
  const local='http://127.0.0.1:8792/__local/artifacts?ticket=payload.'+'a'.repeat(64);
  assert.equal(artifactDownloadUrl(local),null);assert.ok(artifactDownloadUrl(local,true));
  assert.equal(artifactDownloadUrl(local.replace('127.0.0.1:8792','127.0.0.1:8792@evil.test'),true),null);
});
