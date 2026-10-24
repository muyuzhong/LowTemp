// Run: node --test scripts/check-koi.mjs (Canvas calls are checked, not browser pixels).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import sharp from 'sharp';

const { outputFiles } = await build({ entryPoints: ['src/scripts/koi-pond.ts'], bundle: true, write: false, format: 'cjs' });
const source = outputFiles[0].text;
const texture = await sharp('public/assets/koi-top.webp').metadata();
assert.ok(texture.hasAlpha && texture.width > texture.height * 2, 'transparent top-view texture');

for (const [width, height, reduced] of [[1280, 800, false], [390, 844, false], [390, 844, true]]) {
  test(`${width}x${height}, reduced motion: ${reduced}`, async () => {
    const glyphs = [], transforms = [], images = [], draws = [], frames = new Map();
    let serial = 0, now = 0, transparent = false;
    const finite = (...values) => values.forEach(v => assert.ok(Number.isFinite(v), `finite coordinate: ${v}`));
    const gradient = () => ({ addColorStop() {} });
    const context = () => ({
      font: '', globalAlpha: 1, fillStyle: '',
      save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
      moveTo: finite, lineTo: finite, quadraticCurveTo: finite, fillRect: finite, clearRect: finite,
      createLinearGradient: gradient, createRadialGradient: gradient,
      setTransform(...args) { finite(...args); transforms.push(args); },
      drawImage(image, ...args) { finite(...args); draws.push(image); },
      fillText(char, x, y) {
        finite(x, y, this.globalAlpha);
        assert.match(char, /^[\x20-\x7e]$/);
        if (this.font.startsWith('600 ')) {
          assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
          assert.ok(x >= 0 && x <= width && y >= 0 && y <= height);
          glyphs.push(char);
        }
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        // Includes transparent cells, dark scales, translucent orange fins, and pale highlights.
        const colors = [[0, 0, 0, 0], [45, 34, 22, 255], [224, 75, 22, 128], [240, 235, 219, 255]];
        for (let i = 0; i < w * h && !transparent; i++) data.set(colors[(Math.floor(i / w / 2) + Math.floor(i % w / 2)) % 4], i * 4);
        return { data };
      },
    });
    const events = () => ({ addEventListener() {}, removeEventListener() {} });
    const canvas = () => ({ ...events(), width: 0, height: 0, getContext: () => context(), getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) });
    const sandbox = {
      exports: {}, module: { exports: {} }, console,
      document: { documentElement: events(), createElement: canvas },
      window: { setTimeout }, setTimeout, clearTimeout,
      ...events(), devicePixelRatio: 2,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      matchMedia: query => ({ ...events(), matches: query.includes('reduced-motion') && reduced }),
      MutationObserver: class { observe() {} disconnect() {} },
      Image: class { constructor() { images.push(this); } width = texture.width; height = texture.height; },
      performance: { now: () => now },
      requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
      cancelAnimationFrame(id) { frames.delete(id); },
    };
    vm.runInNewContext(source, sandbox);
    const scene = sandbox.module.exports.createKoiPond(canvas());
    assert.ok(scene);
    const step = () => {
      now += 40;
      const work = [...frames.values()]; frames.clear();
      work.forEach(fn => fn(now));
    };
    if (!reduced) step();
    assert.ok(glyphs.length > 0, 'fallback renders ASCII before the image loads');
    assert.ok(new Set(glyphs).size >= 3, 'source brightness produces multiple glyph densities');
    images[0].onload();
    if (!reduced) step();
    assert.ok(draws.includes(images[0]), 'loaded texture replaces the fallback');
    if (reduced) assert.equal(frames.size, 0, 'reduced motion schedules no animation');
    else {
      const start = transforms.length;
      step();
      const before = transforms.slice(start);
      const next = transforms.length;
      step();
      assert.notDeepEqual(transforms.slice(next), before, 'swimming changes the deformation');
    }
    transparent = true; glyphs.length = 0;
    if (reduced) images[0].onload(); else step();
    assert.equal(glyphs.length, 0, 'transparent texture cells do not produce characters');
    let revealed = false;
    scene.reveal(width / 2, height / 2).then(() => { revealed = true; });
    for (let i = 0; !reduced && i < 45; i++) step();
    await Promise.resolve();
    assert.ok(revealed, 'home entry reveal still completes');
    scene.destroy();
    assert.equal(frames.size, 0, 'destroy cancels the animation');
    assert.equal(images[0].onload, null, 'destroy detaches the texture callback');
  });
}
