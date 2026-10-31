import test from 'node:test';
import assert from 'node:assert/strict';
import { asciiPoem, layoutText } from './layout.js';

const rows = (count, width) => Array.from({ length: count }, () => Array.from({ length: width }, (_, column) => column));
const visible = page => Array.from(page, code => code && code !== 32 ? String.fromCharCode(code) : '').join('');

test('normalizes punctuation for the ASCII atlas', () => {
  assert.equal(asciiPoem('“Cœur”—it’s\n  alive…'), '"Coeur"-it\'s\nalive...');
});

test('places the poem in order through available cells', () => {
  const result = layoutText('RED ROOM\nBEAT AGAIN', rows(3, 10), 10);
  assert.equal(result.pages.length, 1);
  assert.ok(visible(result.pages[0]).startsWith('REDROOMBEATAGAIN'));
  assert.equal(Array.from(result.pages[0]).filter(Boolean).length, 30);
});

test('continues long poems across pages without changing character order', () => {
  const poem = Array.from({ length: 10 }, (_, index) => `LINE ${index}`).join('\n');
  const result = layoutText(poem, rows(4, 10), 10);
  assert.ok(result.pages.length > 1);
  assert.ok(result.pages.map(visible).join('').startsWith(poem.replace(/[^A-Z0-9]/g, '')));
});

test('uses disconnected vessels in left-to-right order', () => {
  const slots = [[0, 1, 2, 3, 7, 8, 9, 10], Array.from({ length: 12 }, (_, index) => index)];
  const result = layoutText('HEARTBEAT', slots, 12);
  assert.equal(result.pages[0][0], 'H'.charCodeAt(0));
  assert.equal(result.pages[0][7], 'T'.charCodeAt(0));
  assert.equal(result.pages[0][8], 'B'.charCodeAt(0));
  assert.equal(result.pages[0][4], 0);
});

test('repeats a short poem until the silhouette is filled', () => {
  const result = layoutText('AB', rows(2, 4), 4);
  assert.deepEqual(Array.from(result.pages[0]), [65, 66, 32, 65, 66, 32, 65, 66]);
});
