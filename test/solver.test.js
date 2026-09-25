import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, normalizeInput } from '../server/solver.js';

const bigBoundary = [
  { x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 },
];

// 对称十字布置：内侧 ±3、外侧 ±8 两组候选
function crossPayload(over = {}) {
  return {
    rails: [
      [{ x: -3, y: 0 }, { x: -8, y: 0 }],
      [{ x: 3, y: 0 }, { x: 8, y: 0 }],
      [{ x: 0, y: -3 }, { x: 0, y: -8 }],
      [{ x: 0, y: 3 }, { x: 0, y: 8 }],
    ],
    boundary: [
      { x: -12, y: -12 }, { x: 12, y: -12 }, { x: 12, y: 12 }, { x: -12, y: 12 },
    ],
    cg: { x: 0, y: 0 },
    toleranceX: 2,
    toleranceY: 2,
    minSpacing: 1,
    ...over,
  };
}

test('可行方案：四角严格在内，返回每轨选点与正裕量', () => {
  const r = solve(crossPayload());
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 16);
  assert.deepEqual(r.metrics.indices, [1, 1, 1, 1]);
  assert.ok(r.metrics.minMargin > 0);
  assert.equal(r.corners.length, 4);
  assert.ok(r.corners.every((c) => c.margin > 0));
  assert.equal(r.selection.length, 4);
  r.selection.forEach((s, i) => assert.equal(s.rail, i));
});

test('第一目标：内侧组合更靠近重心但四角越界时，仍选裕量更大的外侧组合', () => {
  const r = solve(crossPayload());
  // 全选外侧(编号2)才能让偏差矩形四角严格在内
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [2, 2, 2, 2]);
});

test('第二目标：裕量持平时选择到标称重心距离和更小的组合', () => {
  // 矩形四角：沿 X 方向有内(±8)外(±12)两档，Y 恒为 ±6。
  // 容差为 0 时只有标称重心一个角点，其裕量由上下边锁定为 6（两档相同），
  // 但内档各点离重心更近，故距离和更小者（编号1）胜出。
  const payload = {
    rails: [
      [{ x: -8, y: -6 }, { x: -12, y: -6 }],
      [{ x: 8, y: -6 }, { x: 12, y: -6 }],
      [{ x: 8, y: 6 }, { x: 12, y: 6 }],
      [{ x: -8, y: 6 }, { x: -12, y: 6 }],
    ],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  };
  const r = solve(payload);
  assert.equal(r.feasible, true);
  assert.ok(Math.abs(r.metrics.minMargin - 6) < 1e-9);
  assert.deepEqual(r.metrics.indices, [0, 0, 0, 0]);
});

test('第三目标：指标完全相同的并列组合，按候选编号字典序取最小', () => {
  const payload = crossPayload();
  // 导轨 1 放入两个完全重合的候选点，几何指标一致，应取编号 1
  payload.rails[0] = [{ x: -8, y: 0 }, { x: -8, y: 0 }];
  const r = solve(payload);
  assert.equal(r.feasible, true);
  assert.equal(r.metrics.indices[0], 0);
});

test('超大但有限的坐标：唯一选择外方形，全部裕量为有限数值', () => {
  // 坐标 ~1e307：坐标差的乘积超出 double 范围，裁决仍须给出有限、正确的
  // 选点与稳定裕量（回归：曾因此把内方形判为最优，裕量序列化为 null）。
  const inner = 9e306;
  const outer = 1e307;
  const bound = 1.1e307;
  const r = solve({
    rails: [
      [{ x: -inner, y: -inner }, { x: -outer, y: -outer }],
      [{ x: inner, y: -inner }, { x: outer, y: -outer }],
      [{ x: inner, y: inner }, { x: outer, y: outer }],
      [{ x: -inner, y: inner }, { x: -outer, y: outer }],
    ],
    boundary: [
      { x: -bound, y: -bound }, { x: bound, y: -bound },
      { x: bound, y: bound }, { x: -bound, y: bound },
    ],
    cg: { x: 0, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  });
  assert.equal(r.feasible, true);
  // 外方形最小裕量约 1e307，严格大于内方形约 9e306，唯一选择候选编号 [2,2,2,2]
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [2, 2, 2, 2]);
  assert.deepEqual(r.metrics.indices, [1, 1, 1, 1]);
  // 四个角点裕量与 minMargin 都必须是有限数值且约为 1e307
  assert.equal(r.corners.length, 4);
  for (const c of r.corners) {
    assert.ok(Number.isFinite(c.margin), `角点 ${c.label} 的裕量必须是有限数值，got ${c.margin}`);
    assert.ok(Math.abs(c.margin - 1e307) <= 1e307 * 1e-9, `角点 ${c.label} 裕量应约为 1e307，got ${c.margin}`);
  }
  assert.ok(Number.isFinite(r.metrics.minMargin), 'minMargin 必须是有限数值');
  assert.ok(Math.abs(r.metrics.minMargin - 1e307) <= 1e307 * 1e-9);
  assert.ok(r.metrics.minMargin > 9e306, '外方形裕量应严格大于内方形约 9e306');
  // JSON 序列化后裕量不得退化为 null
  const roundTrip = JSON.parse(JSON.stringify(r));
  assert.ok(roundTrip.corners.every((c) => typeof c.margin === 'number' && Number.isFinite(c.margin)));
  assert.equal(typeof roundTrip.metrics.minMargin, 'number');
});

test('大幅平移坐标：1e307 平移基准下的唯一有效支撑不被误判为退化', () => {
  // 回归：鞋带公式在巨型平移项相互抵消下得到 <=0 的噪声面积，唯一可行组合
  // 曾被误判为 hull_degenerate、minCornerMargin 序列化为 null。
  const T = 1e307; // 平移基准
  const h = 2e292; // 支撑方形半边长（四点边长约 3.99e292）
  const b = 4e292; // 批准边界半边长（同一中心的更大方形）
  const r = solve({
    rails: [
      [{ x: T - h, y: T - h }],
      [{ x: T + h, y: T - h }],
      [{ x: T + h, y: T + h }],
      [{ x: T - h, y: T + h }],
    ],
    boundary: [
      { x: T - b, y: T - b }, { x: T + b, y: T - b },
      { x: T + b, y: T + b }, { x: T - b, y: T + b },
    ],
    cg: { x: T, y: T },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  });
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 1);
  // 四条导轨各自唯一的候选（编号 [1,1,1,1]）
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [1, 1, 1, 1]);
  assert.deepEqual(r.metrics.indices, [0, 0, 0, 0]);
  // 四个角点裕量与 minMargin 均为有限正数，约为半边长 2e292
  const nearHalfSide = (v) => Number.isFinite(v) && Math.abs(v - 2e292) <= 2e292 * 1e-2;
  assert.equal(r.corners.length, 4);
  for (const c of r.corners) {
    assert.ok(nearHalfSide(c.margin), `角点 ${c.label} 裕量应约为 2e292，got ${c.margin}`);
  }
  assert.ok(nearHalfSide(r.metrics.minMargin), `minMargin 应约为 2e292，got ${r.metrics.minMargin}`);
  // JSON 序列化后裕量不得退化为 null
  const roundTrip = JSON.parse(JSON.stringify(r));
  assert.ok(roundTrip.corners.every((c) => typeof c.margin === 'number' && Number.isFinite(c.margin)));
  assert.equal(typeof roundTrip.metrics.minMargin, 'number');
});

test('极小局部尺度：~1e-300 量级的唯一有效支撑不被误判为退化', () => {
  // 回归：坐标差乘积直接下溢为 0 时，凸包转向判断与面积计算会退化为
  // “共线”，唯一可行组合曾被误判为 hull_degenerate。
  const h = 2e-300; // 支撑方形半边长
  const b = 4e-300; // 批准边界半边长
  const r = solve({
    rails: [
      [{ x: -h, y: -h }],
      [{ x: h, y: -h }],
      [{ x: h, y: h }],
      [{ x: -h, y: h }],
    ],
    boundary: [
      { x: -b, y: -b }, { x: b, y: -b },
      { x: b, y: b }, { x: -b, y: b },
    ],
    cg: { x: 0, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1e-301,
  });
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 1);
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [1, 1, 1, 1]);
  assert.deepEqual(r.metrics.indices, [0, 0, 0, 0]);
  // 四个角点裕量与 minMargin 均为有限正数，约为半边长 2e-300
  const nearHalfSide = (v) => Number.isFinite(v) && Math.abs(v - 2e-300) <= 2e-300 * 1e-9;
  assert.equal(r.corners.length, 4);
  for (const c of r.corners) {
    assert.ok(nearHalfSide(c.margin), `角点 ${c.label} 裕量应约为 2e-300，got ${c.margin}`);
  }
  assert.ok(nearHalfSide(r.metrics.minMargin), `minMargin 应约为 2e-300，got ${r.metrics.minMargin}`);
});

test('间距约束：最小间距无法满足时判定不可行并给出间距证据', () => {
  const r = solve(crossPayload({ minSpacing: 100 }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'spacing_failed');
  assert.ok(r.evidence.minGap < 100);
  assert.deepEqual(r.evidence.candidateNumbers.length, 4);
});

test('角点越界：凸包有效但容差过大时返回 corners_failed 证据', () => {
  const r = solve(crossPayload({ toleranceX: 6, toleranceY: 6, minSpacing: 1 }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'corners_failed');
  assert.ok(r.evidence.minCornerMargin <= 0);
  assert.ok(r.evidence.corners.some((c) => c.margin <= 0));
});

test('边界约束：候选点全部越界时返回 boundary_failed 证据', () => {
  const r = solve(crossPayload({
    boundary: [
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
    ],
  }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'boundary_failed');
  assert.ok(r.evidence.outside.length > 0);
});

test('共线选点导致凸包退化时返回 hull_degenerate', () => {
  const payload = {
    rails: [
      [{ x: -6, y: 0 }, { x: -3, y: 0 }],
      [{ x: 6, y: 0 }, { x: 3, y: 0 }],
      [{ x: -2, y: 0 }],
      [{ x: 2, y: 0 }],
    ],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1,
    toleranceY: 1,
    minSpacing: 0,
  };
  const r = solve(payload);
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'hull_degenerate');
});

test('输入校验：导轨数量不是 4 条时抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[], [], []],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1, toleranceY: 1, minSpacing: 1,
  }), /4 条导轨/);
});

test('输入校验：负值偏差抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[{ x: 0, y: 0 }], [{ x: 1, y: 0 }], [{ x: 0, y: 1 }], [{ x: 1, y: 1 }]],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: -1, toleranceY: 1, minSpacing: 1,
  }), /toleranceX/);
});

test('非数值坐标抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[{ x: 'a', y: 0 }], [{ x: 1, y: 0 }], [{ x: 0, y: 1 }], [{ x: 1, y: 1 }]],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1, toleranceY: 1, minSpacing: 1,
  }), /有限数值/);
});
