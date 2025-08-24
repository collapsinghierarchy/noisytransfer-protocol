import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUUID } from '../src/uuid.js';

test('makeUUID returns UUID v4 strings', () => {
  const id = makeUUID();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});