import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull,
  ensureCCW,
  convexMargin,
  lineSide,
  pointInPolygon,
  polygonSignedArea,
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

test('大幅平移下多边形面积保持正确符号（平移不变）', () => {
  // 平移基准 1e307、局部跨度 1e292：绝对坐标鞋带和的面积信号（跨度²）远小于
  // 坐标乘积的舍入误差，曾得到 0 或噪声符号，把有效凸包误判为退化
  const T = 1e307;
  const h = 2e292;
  const ccw = [
    { x: T - h, y: T - h }, { x: T + h, y: T - h },
    { x: T + h, y: T + h }, { x: T - h, y: T + h },
  ];
  assert.ok(polygonSignedArea(ccw) > 0);
  assert.ok(polygonSignedArea(ccw.slice().reverse()) < 0);
});

test('中等平移下多边形面积数值准确（1e12 平移）', () => {
  // 坐标均为精确可表示的整数，平移后面积应与未平移完全一致
  const T = 1e12;
  const ccw = [
    { x: T - 8, y: T - 8 }, { x: T + 8, y: T - 8 },
    { x: T + 8, y: T + 8 }, { x: T - 8, y: T + 8 },
  ];
  assert.equal(polygonSignedArea(ccw), 256);
  assert.equal(polygonSignedArea(ccw.slice().reverse()), -256);
});

test('极小局部尺度下多边形面积保持正确符号与量级', () => {
  const h = 1e-12;
  const ccw = [
    { x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h },
  ];
  const area = polygonSignedArea(ccw);
  assert.ok(area > 0);
  assert.ok(Math.abs(area - 4e-24) <= 4e-24 * 1e-9, `面积应约为 4e-24，got ${area}`);
});

test('超大坐标下 pointInPolygon 正确识别斜边上的点', () => {
  const d = 1e307;
  const tri = [{ x: -d, y: -d }, { x: d, y: -d }, { x: -d, y: d }];
  assert.equal(pointInPolygon(tri, { x: 0, y: 0 }), true); // 原点恰在斜边上
  assert.equal(pointInPolygon(tri, { x: -0.5 * d, y: 0 }), true);
  assert.equal(pointInPolygon(tri, { x: 0.5 * d, y: 0.5 * d }), false);
});
