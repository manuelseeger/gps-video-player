import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseVersion} from './release-version.mjs';

test('stable release tags', () => {
  for (const version of ['3.2.1', '0.0.0', '10.20.30']) {
    assert.deepEqual(releaseVersion(version), {version, prerelease: false});
  }
});

test('preview release tags', () => {
  for (const version of ['3.2.1-preview.1', '0.1.0-preview.0']) {
    assert.deepEqual(releaseVersion(version), {version, prerelease: true});
  }
});

test('reject unsupported or non-canonical release tags', () => {
  for (const tag of ['', 'v3.2.1', '3.2', '03.2.1', '3.02.1', '3.2.01',
    '3.2.1-preview.01', '3.2.1-preview', '3.2.1-beta.1', '3.2.1+build',
    '3.2.1\n', '3.2.1;echo unsafe']) {
    assert.throws(() => releaseVersion(tag));
  }
});
