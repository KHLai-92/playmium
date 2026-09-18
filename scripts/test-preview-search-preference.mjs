import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/preview-search-preference.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
const { createPreviewSearchPreference, previewUrlSearchKey } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("URL choice survives new preference instances and can persistently return to ID", async () => {
  const values = {};
  const storage = { async get() { return {...values}; }, async set(update) { Object.assign(values, update); } };
  const first = [], second = [], third = [];
  const a = createPreviewSearchPreference(storage, value => first.push(value));
  await a.ready;
  assert.deepEqual(first, [true]);
  await a.set(true);
  const b = createPreviewSearchPreference(storage, value => second.push(value));
  await b.ready;
  assert.deepEqual(second, [true], "a new document/session loads saved URL mode");
  await b.set(false);
  const c = createPreviewSearchPreference(storage, value => third.push(value));
  await c.ready;
  assert.deepEqual(third, [false]);
});

test("another tab's update wins over a stale initial load", async () => {
  let resolve;
  const applied = [];
  const preference = createPreviewSearchPreference({ get: () => new Promise(r => { resolve = r; }), async set() {} }, value => applied.push(value));
  preference.receive(true);
  resolve({[previewUrlSearchKey]:false});
  await preference.ready;
  assert.deepEqual(applied, [true]);
  preference.receive(undefined);
  assert.deepEqual(applied, [true,true], 'removing the saved setting restores the default');
});

test("a user change wins over a stale initial load and storage failures are surfaced", async () => {
  let resolve;
  const applied = [];
  const preference = createPreviewSearchPreference({ get: () => new Promise(r => { resolve = r; }), async set() { throw Error('storage unavailable'); } }, value => applied.push(value));
  await assert.rejects(preference.set(true), /storage unavailable/);
  resolve({[previewUrlSearchKey]:false});
  await preference.ready;
  assert.deepEqual(applied,[true]);
});

test("invalid saved values and failed initial reads safely use ID", async () => {
  for (const value of [undefined, "true", 1, null]) {
    const applied = [];
    await createPreviewSearchPreference({ async get() { return {[previewUrlSearchKey]:value}; }, async set() {} }, v => applied.push(v)).ready;
    assert.deepEqual(applied,[true]);
  }
  const applied=[];
  await createPreviewSearchPreference({ async get() { throw Error('unavailable'); }, async set() {} }, v => applied.push(v)).ready;
  assert.deepEqual(applied,[true]);
});
