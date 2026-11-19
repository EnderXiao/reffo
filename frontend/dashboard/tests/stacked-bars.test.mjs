import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getColumnCount,
  getHoverGeometry,
  getPlotGeometry,
  getStackLayout,
  observePlotWidth,
  pickColumn,
} from '../src/components/charts/bencho/stacked-bars-layout.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' ≈ ' + expected);

test('column counts follow actual days, including no days, one day, and a one-bar request', () => {
  assert.equal(getColumnCount(0, 7), 0);
  assert.equal(getColumnCount(1, 7), 1);
  assert.equal(getColumnCount(7, 1), 1);
  assert.equal(getColumnCount(7, 0), 0);
  assert.equal(getColumnCount(3, 7), 3);
  assert.equal(getColumnCount(14, 7), 7);
  assert.equal(getColumnCount(7, Number.NaN), 0);
});

test('unmeasured or hidden plots never invent a 300px layout or an active column', () => {
  for (const width of [0, -1, Number.NaN]) {
    const geometry = getPlotGeometry(width, 7, 4);
    assert.equal(geometry.width, 0);
    assert.equal(geometry.barWidth, 0);
    assert.ok(geometry.columns.every((column) => column.left === 0 && column.width === 0));
    assert.equal(pickColumn(geometry, 0), null);
    assert.equal(getHoverGeometry(geometry, 0, 132), null);
  }
  const empty = getPlotGeometry(1100, 0, 4);
  assert.deepEqual(empty.columns, []);
  assert.equal(pickColumn(empty, 1099), null);
  assert.equal(getHoverGeometry(empty, 0, 132), null);
});

test('1100px plot places and picks the sixth/seventh days in the right-hand area', () => {
  const geometry = getPlotGeometry(1100, 7, 4);
  close(geometry.barWidth, (1100 - 6 * 4) / 7);
  for (const index of [5, 6]) {
    const column = geometry.columns[index];
    assert.ok(column.left > 700);
    assert.equal(pickColumn(geometry, column.left + column.width / 2), index);
    const hover = getHoverGeometry(geometry, index, 132);
    assert.ok(hover.ringLeft <= column.left);
    assert.ok(hover.ringLeft + hover.ringWidth >= column.left + column.width - 1e-8);
    assert.ok(hover.tipLeft >= 0);
    assert.ok(hover.tipLeft + hover.tipWidth <= geometry.width);
  }
  close(geometry.columns[6].left + geometry.columns[6].width, 1100);
});

test('hit testing matches painted column intervals, gaps, plot edges, and capture outside', () => {
  const geometry = getPlotGeometry(1100, 7, 24);
  assert.equal(pickColumn(geometry, -0.01), null);
  assert.equal(pickColumn(geometry, 0), 0);
  assert.equal(pickColumn(geometry, 1100), 6);
  assert.equal(pickColumn(geometry, 1100.01), null);
  assert.equal(pickColumn(geometry, Number.NaN), null);
  for (let index = 0; index < 6; index++) {
    const right = geometry.columns[index].left + geometry.columns[index].width;
    const next = geometry.columns[index + 1].left;
    assert.equal(pickColumn(geometry, right - 0.001), index);
    assert.equal(pickColumn(geometry, right), null);
    assert.equal(pickColumn(geometry, (right + next) / 2), null);
    assert.equal(pickColumn(geometry, next - 0.001), null);
    assert.equal(pickColumn(geometry, next), index + 1);
  }
  const noGap = getPlotGeometry(1100, 7, 0);
  assert.equal(pickColumn(noGap, noGap.columns[1].left), 1);
});

test('resize and narrow containers keep columns, rings, and tooltips in the same plot bounds', () => {
  for (const width of [1100, 632, 145.5, 132, 84, 29, 2, 0, 1100]) {
    for (const count of [1, 7]) {
      const geometry = getPlotGeometry(width, count, 24);
      assert.ok(geometry.gap >= 0);
      assert.ok(geometry.barWidth >= 0);
      if (width === 0) continue;
      close(geometry.columns.at(-1).left + geometry.barWidth, width);
      for (let index = 0; index < count; index++) {
        const column = geometry.columns[index];
        assert.equal(pickColumn(geometry, column.left + column.width / 2), index);
        const hover = getHoverGeometry(geometry, index, 132);
        assert.ok(hover.ringLeft >= 0);
        assert.ok(hover.ringLeft + hover.ringWidth <= width + 1e-8);
        assert.ok(hover.tipLeft >= 0);
        assert.ok(hover.tipLeft + hover.tipWidth <= width + 1e-8);
        assert.equal(hover.tipWidth, Math.min(132, width));
      }
    }
  }
  assert.equal(getPlotGeometry(1100, 1, 24).barWidth, 1100);
  assert.equal(getPlotGeometry(1100, 1, 24).gap, 0);
});

test('zero values produce no visible segments or phantom gaps, while positive stacks fit their height', () => {
  assert.deepEqual(getStackLayout([], 100, 2), { totals: [], layout: [] });
  const { totals, layout } = getStackLayout([[0, 0, 0], [0, 10, 0], [10, 0, 10]], 100, 2);
  assert.deepEqual(totals, [0, 10, 20]);
  assert.equal(layout[0].top, 0);
  assert.ok(layout[0].segs.every((segment) => segment.h === 0));
  assert.equal(layout[1].segs[0].h, 0);
  assert.equal(layout[1].segs[1].bottom, 0);
  assert.equal(layout[1].segs[2].h, 0);
  close(layout[1].top, layout[1].segs[1].h);
  close(layout[2].segs[2].bottom, layout[2].segs[0].h + 2);
  close(layout[2].top, 100);
  const tiny = getStackLayout([[10000, 1, 1]], 100, 2).layout[0];
  assert.ok(tiny.segs.every((segment) => segment.h > 0));
  close(tiny.top, 100);
});

test('plot attachment measures immediately, tracks zero/visible resize, and cleans up on chart remount', (t) => {
  const observers = [];
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  t.after(() => {
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
    else delete globalThis.ResizeObserver;
  });
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.target = element; }
    disconnect() { this.disconnected = true; }
    notify() { this.callback([], this); }
  };
  let width = 1100;
  const plot = { getBoundingClientRect: () => ({ width }) };
  const measurements = [];
  // No observer exists while async data is empty; attach only once the plot is present.
  assert.equal(observers.length, 0);
  const detach = observePlotWidth(plot, (next) => measurements.push(next));
  assert.deepEqual(measurements, [1100]);
  assert.equal(observers[0].target, plot);
  for (const next of [632, 0, 1072]) { width = next; observers[0].notify(); }
  assert.deepEqual(measurements, [1100, 632, 0, 1072]);
  detach();
  assert.equal(observers[0].disconnected, true);
  width = 999;
  observers[0].notify();
  assert.equal(measurements.at(-1), 1072);
  const replacement = { getBoundingClientRect: () => ({ width: 1040 }) };
  const detachReplacement = observePlotWidth(replacement, (next) => measurements.push(next));
  assert.equal(observers[1].target, replacement);
  assert.equal(measurements.at(-1), 1040);
  detachReplacement();
});
