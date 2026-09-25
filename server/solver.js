// 方案求解器：在四条导轨候选点的完整组合中直接裁决。
//
// 决策规则（按优先级）：
//   1. 硬约束：每轨恰选一点；选点在批准边界内；任意两垫间距 >= minSpacing；
//      重心偏差矩形的四个角点严格位于四点支撑凸包内部。
//   2. 在全部可行组合中，先最大化“四角到凸包边界的最小有符号距离”；
//      再最小化“四垫到标称重心的距离和”；
//      再按导轨输入顺序的候选编号序列取字典序最小者，保证方案唯一稳定。
//   3. 无可行方案时，返回在约束检查流程中“走得最远、违约最小”的组合作为证据。

import {
  convexHull,
  ensureCCW,
  convexMargin,
  pointInPolygon,
  pointDistance,
  polygonSignedDistance,
  distanceToSegment,
  polygonSignedArea,
} from './geometry.js';

const EPS = 1e-9;
const RAIL_COUNT = 4;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function parsePoint(p, where) {
  if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    throw new Error(`${where} 的点必须是有限数值 {x, y}`);
  }
  return { x: p.x, y: p.y };
}

/**
 * 校验并归一化请求。返回规范化后的输入；非法时抛出带中文说明的错误。
 */
export function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('请求体必须是 JSON 对象');

  if (!Array.isArray(raw.rails) || raw.rails.length !== RAIL_COUNT) {
    throw new Error(`必须提供恰好 ${RAIL_COUNT} 条导轨的候选点（rails 为长度 ${RAIL_COUNT} 的数组）`);
  }
  const rails = raw.rails.map((candidates, r) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(`第 ${r + 1} 条导轨至少需要一个候选点`);
    }
    return candidates.map((p, i) => parsePoint(p, `第 ${r + 1} 条导轨的第 ${i + 1} 个候选点`));
  });

  if (!Array.isArray(raw.boundary) || raw.boundary.length < 3) {
    throw new Error('翼板批准边界 boundary 至少需要 3 个顶点');
  }
  const boundary = ensureCCW(
    raw.boundary.map((p, i) => parsePoint(p, `边界第 ${i + 1} 个顶点`))
  );

  const cg = parsePoint(raw.cg ?? null, '重心标称坐标 cg');

  const toleranceX = raw.toleranceX;
  const toleranceY = raw.toleranceY;
  if (!isFiniteNumber(toleranceX) || toleranceX < 0) {
    throw new Error('横向偏差 toleranceX 必须是非负数值');
  }
  if (!isFiniteNumber(toleranceY) || toleranceY < 0) {
    throw new Error('纵向偏差 toleranceY 必须是非负数值');
  }
  if (!isFiniteNumber(raw.minSpacing) || raw.minSpacing < 0) {
    throw new Error('支撑垫最小间距 minSpacing 必须是非负数值');
  }

  return {
    rails,
    boundary,
    cg,
    toleranceX,
    toleranceY,
    minSpacing: raw.minSpacing,
  };
}

export function deviationCorners(cg, tx, ty) {
  return [
    { label: '左下', x: cg.x - tx, y: cg.y - ty },
    { label: '右下', x: cg.x + tx, y: cg.y - ty },
    { label: '右上', x: cg.x + tx, y: cg.y + ty },
    { label: '左上', x: cg.x - tx, y: cg.y + ty },
  ];
}

function pairGap(points) {
  let minGap = Infinity;
  let pair = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = pointDistance(points[i], points[j]);
      if (d < minGap) {
        minGap = d;
        pair = [i, j];
      }
    }
  }
  return { minGap, pair };
}

/**
 * 评估单个组合，返回约束状态与各项指标。
 * stage:
 *   boundary_failed -> spacing_failed -> hull_degenerate -> corners_failed -> feasible
 */
function evaluate(indices, input, corners) {
  const points = indices.map((idx, r) => input.rails[r][idx]);

  const outside = [];
  for (let i = 0; i < points.length; i++) {
    if (!pointInPolygon(input.boundary, points[i])) {
      outside.push({
        rail: i,
        amount: -polygonSignedDistance(input.boundary, points[i]),
      });
    }
  }
  if (outside.length > 0) {
    return {
      status: 'boundary_failed',
      stage: 0,
      indices,
      points,
      outside,
      deficit: Math.max(...outside.map((o) => o.amount)),
    };
  }

  const { minGap, pair } = pairGap(points);
  if (minGap + EPS < input.minSpacing) {
    return {
      status: 'spacing_failed',
      stage: 1,
      indices,
      points,
      minGap,
      pair,
      deficit: input.minSpacing - minGap,
    };
  }

  const hull = ensureCCW(convexHull(points));
  const area = polygonSignedArea(hull);
  if (hull.length < 3 || area <= EPS) {
    // 退化凸包：用角点到凸包点集/线段的最近距离量化“差多少”
    let worst = 0;
    for (const c of corners) {
      let nearest = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        nearest = Math.min(nearest, distanceToSegment(c, a, b));
      }
      worst = Math.max(worst, nearest);
    }
    return {
      status: 'hull_degenerate',
      stage: 2,
      indices,
      points,
      hull,
      minGap,
      deficit: worst,
    };
  }

  const cornerResults = corners.map((c) => ({
    ...c,
    margin: convexMargin(hull, c),
  }));
  const minCornerMargin = Math.min(...cornerResults.map((c) => c.margin));

  if (minCornerMargin <= EPS) {
    return {
      status: 'corners_failed',
      stage: 3,
      indices,
      points,
      hull,
      cornerResults,
      minGap,
      minCornerMargin,
      deficit: -minCornerMargin, // 越大的裕量越接近可行
    };
  }

  const sumDistance = points.reduce((s, p) => s + pointDistance(p, input.cg), 0);
  return {
    status: 'feasible',
    stage: 4,
    indices,
    points,
    hull,
    cornerResults,
    minGap,
    minCornerMargin,
    sumDistance,
  };
}

function describeFailure(r) {
  switch (r.status) {
    case 'boundary_failed':
      return `选点越出翼板批准边界：导轨 ${r.outside.map((o) => o.rail + 1).join('、')} 的候选点在界外（最远越界 ${r.deficit.toFixed(4)}）`;
    case 'spacing_failed':
      return `支撑垫间距不足：最小间距 ${r.minGap.toFixed(4)}，最小要求未满足，缺口 ${r.deficit.toFixed(4)}（导轨 ${r.pair[0] + 1} 与 ${r.pair[1] + 1}）`;
    case 'hull_degenerate':
      return '四个选点共线或重合，支撑凸包退化，无法围出有效支撑区域';
    case 'corners_failed':
      return `重心偏差矩形存在角点不在支撑凸包内部：最小有符号距离 ${r.minCornerMargin.toFixed(4)}（<=0 表示越界）`;
    default:
      return '无可行方案';
  }
}

/**
 * 主求解入口。输入为已解析的请求体，返回响应对象。
 */
export function solve(raw) {
  const input = normalizeInput(raw);
  const corners = deviationCorners(input.cg, input.toleranceX, input.toleranceY);

  const [r0, r1, r2, r3] = input.rails.map((c) => c.length);
  let evaluated = 0;
  let best = null;
  let closestFailure = null;

  // 按导轨输入顺序、候选编号升序枚举，天然字典序，首个最优即稳定唯一解。
  for (let i0 = 0; i0 < r0; i0++) {
    for (let i1 = 0; i1 < r1; i1++) {
      for (let i2 = 0; i2 < r2; i2++) {
        for (let i3 = 0; i3 < r3; i3++) {
          const indices = [i0, i1, i2, i3];
          const result = evaluate(indices, input, corners);
          evaluated++;

          if (result.status !== 'feasible') {
            if (
              closestFailure === null ||
              result.stage > closestFailure.stage ||
              (result.stage === closestFailure.stage && result.deficit < closestFailure.deficit - EPS)
            ) {
              closestFailure = result;
            }
            continue;
          }

          if (
            best === null ||
            result.minCornerMargin > best.minCornerMargin + EPS ||
            (Math.abs(result.minCornerMargin - best.minCornerMargin) <= EPS &&
              result.sumDistance < best.sumDistance - EPS)
            // minCornerMargin 与距离和均持平时保留先枚举到的（字典序最小）组合
          ) {
            best = result;
          }
        }
      }
    }
  }

  if (best) {
    return {
      feasible: true,
      evaluatedCombinations: evaluated,
      selection: best.indices.map((idx, rail) => ({
        rail,
        candidateIndex: idx,
        candidateNumber: idx + 1,
        x: best.points[rail].x,
        y: best.points[rail].y,
      })),
      hull: best.hull,
      corners: best.cornerResults,
      metrics: {
        minMargin: best.minCornerMargin,
        sumDistance: best.sumDistance,
        minGap: best.minGap,
        indices: best.indices,
      },
    };
  }

  return {
    feasible: false,
    evaluatedCombinations: evaluated,
    reason: closestFailure ? closestFailure.status : 'no_combination',
    message: closestFailure ? describeFailure(closestFailure) : '不存在任何候选组合',
    evidence: closestFailure && {
      status: closestFailure.status,
      indices: closestFailure.indices,
      candidateNumbers: closestFailure.indices.map((i) => i + 1),
      points: closestFailure.points,
      hull: closestFailure.hull,
      corners: closestFailure.cornerResults ?? corners,
      minGap: closestFailure.minGap ?? null,
      minCornerMargin: closestFailure.minCornerMargin ?? null,
      outside: closestFailure.outside ?? null,
      deficit: closestFailure.deficit,
    },
  };
}
