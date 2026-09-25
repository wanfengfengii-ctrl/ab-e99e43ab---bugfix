import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull,
  ensureCCW,
  convexMargin,
  lineSide,
  pointInPolygon,
  polygonSignedArea,
  polygonNormalizedSignedArea,
} from '../server/geometry.js';

test('凸包按逆时针返回并剔除共线点', () => {
  const hull = ensureCCW(convexHull([
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 },
    { x: 0, y: 2 }, { x: 1, y: 1 },
  ]));
  assert.equal(hull.length, 4);
  assert.ok(polygonSignedArea(hull) > 0);
});

test('内部点有符号距离为正，外部为负', () => {
  const hull = ensureCCW([
    { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 },
  ]);
  assert.ok(convexMargin(hull, { x: 0, y: 0 }) > 0);
  assert.equal(convexMargin(hull, { x: 0, y: 0 }).toFixed(3), '5.000');
  assert.ok(convexMargin(hull, { x: 0, y: 6 }) < 0);
});

test('恰在边上的点有符号距离为 0（不满足严格在内）', () => {
  const hull = ensureCCW([
    { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 },
  ]);
  assert.equal(convexMargin(hull, { x: 0, y: 5 }), 0);
});

test('lineSide 左侧为正', () => {
  assert.ok(lineSide({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }) > 0);
  assert.ok(lineSide({ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }) < 0);
});

test('pointInPolygon 含边界', () => {
  const poly = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(pointInPolygon(poly, { x: 2, y: 2 }), true);
  assert.equal(pointInPolygon(poly, { x: 4, y: 2 }), true);
  assert.equal(pointInPolygon(poly, { x: 5, y: 2 }), false);
});

test('超大坐标（~1e307）下有符号距离保持有限', () => {
  const d = 1e307;
  const hull = ensureCCW(convexHull([
    { x: -d, y: -d }, { x: d, y: -d }, { x: d, y: d }, { x: -d, y: d },
  ]));
  assert.equal(hull.length, 4);
  const m = convexMargin(hull, { x: 0, y: 0 });
  assert.ok(Number.isFinite(m), `裕量必须有限，got ${m}`);
  assert.ok(Math.abs(m - d) <= d * 1e-9, `裕量应约为 1e307，got ${m}`);
});

test('超大坐标下凸包正确剔除内部点', () => {
  const d = 1e307;
  // 旋转 45° 的方形加一个内部点：溢出会让转向判断退化为 NaN 而错误保留内部点
  const hull = convexHull([
    { x: d, y: 0 }, { x: 0, y: d }, { x: -d, y: 0 }, { x: 0, y: -d },
    { x: 0.4 * d, y: 0.4 * d },
  ]);
  assert.equal(hull.length, 4);
});

test('超大坐标下多边形面积保持正确符号', () => {
  const d = 1e307;
  // 一条边穿过原点，鞋带公式各项异号，直接累加会得到 NaN
  const ccw = [{ x: d, y: -d }, { x: d, y: d }, { x: -d, y: d }];
  assert.ok(polygonSignedArea(ccw) > 0);
  assert.ok(polygonSignedArea(ccw.slice().reverse()) < 0);
});

test('超大坐标下 pointInPolygon 正确识别斜边上的点', () => {
  const d = 1e307;
  const tri = [{ x: -d, y: -d }, { x: d, y: -d }, { x: -d, y: d }];
  assert.equal(pointInPolygon(tri, { x: 0, y: 0 }), true); // 原点恰在斜边上
  assert.equal(pointInPolygon(tri, { x: -0.5 * d, y: 0 }), true);
  assert.equal(pointInPolygon(tri, { x: 0.5 * d, y: 0.5 * d }), false);
});

test('大幅平移坐标下多边形面积不被平移项抵消吞掉', () => {
  // 平移基准 1e160、局部跨度 1e152：真实面积 ~4e304 完全可表示，
  // 但直接鞋带累加会因平移项相互抵消丢失全部有效数字（旧实现给出纯噪声）
  const T = 1e160;
  const s = 1e152;
  const square = [
    { x: T - s, y: T - s }, { x: T + s, y: T - s },
    { x: T + s, y: T + s }, { x: T - s, y: T + s },
  ];
  const side = square[1].x - square[0].x; // 坐标差在 double 下精确
  const expected = side * side;
  const area = polygonSignedArea(square);
  assert.ok(Number.isFinite(area), `面积必须有限，got ${area}`);
  assert.ok(Math.abs(area - expected) <= expected * 1e-9, `面积应约为 ${expected}，got ${area}`);
  assert.ok(polygonSignedArea(square.slice().reverse()) < 0);
});

test('大幅平移 + 超大跨度下面积保持正确符号（真值超出 double）', () => {
  // 平移基准 1e307、局部跨度 1e292：真实面积 ~1.6e585 超出 double 范围，
  // 面积应给出正号（+Infinity），归一化面积仍约为 1
  const T = 1e307;
  const s = 2e292;
  const square = [
    { x: T - s, y: T - s }, { x: T + s, y: T - s },
    { x: T + s, y: T + s }, { x: T - s, y: T + s },
  ];
  assert.ok(polygonSignedArea(square) > 0);
  assert.ok(polygonSignedArea(square.slice().reverse()) < 0);
  assert.ok(Math.abs(polygonNormalizedSignedArea(square) - 1) < 1e-12);
});

test('归一化有符号面积与坐标量级无关，退化时约为 0', () => {
  for (const d of [1, 1e-300, 1e292]) {
    const sq = [
      { x: -d, y: -d }, { x: d, y: -d }, { x: d, y: d }, { x: -d, y: d },
    ];
    assert.ok(Math.abs(polygonNormalizedSignedArea(sq) - 1) < 1e-12, `尺度 ${d}`);
    assert.ok(Math.abs(polygonNormalizedSignedArea(sq.slice().reverse()) + 1) < 1e-12, `尺度 ${d} 反向`);
  }
  assert.equal(polygonNormalizedSignedArea([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), 0);
  assert.equal(polygonNormalizedSignedArea([{ x: 5, y: 5 }, { x: 5, y: 5 }]), 0);
});

test('极小坐标（~1e-300）下凸包正确剔除内部点', () => {
  const d = 1e-300;
  // 坐标差乘积 ~1e-600 直接下溢为 0，转向判断曾因此把一切视为共线
  const hull = convexHull([
    { x: d, y: 0 }, { x: 0, y: d }, { x: -d, y: 0 }, { x: 0, y: -d },
    { x: 0.4 * d, y: 0.4 * d },
  ]);
  assert.equal(hull.length, 4);
});

test('极小坐标（~1e-300）下定向与有符号距离保持正确', () => {
  const d = 1e-300;
  const cw = [
    { x: -d, y: -d }, { x: -d, y: d }, { x: d, y: d }, { x: d, y: -d },
  ];
  const hull = ensureCCW(cw);
  assert.ok(polygonNormalizedSignedArea(hull) > 0);
  const m = convexMargin(hull, { x: 0, y: 0 });
  assert.ok(Number.isFinite(m), `裕量必须有限，got ${m}`);
  assert.ok(Math.abs(m - d) <= d * 1e-9, `裕量应约为 1e-300，got ${m}`);
});
