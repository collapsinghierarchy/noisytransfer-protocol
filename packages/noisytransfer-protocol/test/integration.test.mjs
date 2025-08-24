import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as protocol from '../src/index.js';
import { CHUNK_SIZE } from '../src/constants.js';

test('aggregator exports namespaces and constants', () => {
  assert.ok(protocol.crypto);
  assert.ok(CHUNK_SIZE > 0);
});