// 纯计算几何工具：二维点、有符号距离、凸包、点与简单多边形关系。
// 所有多边形约定按逆时针(CCW)给出边时，内部位于每条有向边的左侧，
// 因此“点到边的有符号距离”为正表示在内部、为负表示在外部、为 0 表示恰在边界上。
//
// 坐标可以是超大但有限的数值（如 1e307）：坐标之差仍在 double 范围内，
// 但两个坐标差的乘积会溢出为 Infinity（进而产生 NaN）。凡涉及坐标差乘积的
// 计算（叉积、面积、投影），这里都采用“先归一化/缩放再相乘”的写法，
// 保证超大坐标下仍得到有限、符号正确的结果。
//
// 坐标也可能带巨大的平移基准（如 1e307 平移、1e292 局部跨度）或处于极小
// 局部尺度（如 1e-300）：前者让面积公式中的平移项相互抵消、吞掉真实面积，
// 后者让坐标差乘积直接下溢为 0。因此面积计算先平移到首顶点（平移不改变
// 面积，且坐标差在 double 下精确）再归一化累加；叉积始终按最大分量归一化，
// 保证任意平移与量级下符号与是否为零的判断都正确。

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

/**
 * 两个差向量的叉积 ux*vy - uy*vx 的溢出/下溢安全版本。
 * 始终按最大分量归一化后再相乘：坐标差 ~1e307 量级时乘积不会溢出为 Infinity，
 * ~1e-300 量级时也不会下溢为 0。返回值的符号与是否为零始终和真实叉积一致，
 * 供只需判断转向/是否为零的调用方使用。
 */
function crossDiffs(ux, uy, vx, vy) {
  const m = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(vx), Math.abs(vy));
  if (!(m > 0) || !Number.isFinite(m)) return ux * vy - uy * vx;
  return (ux / m) * (vy / m) - (uy / m) * (vx / m);
}

export function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 点 p 到过 a、b 的直线的有符号距离（沿 a->b 方向，左侧为正）。
 */
export function lineSide(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return pointDistance(p, a);
  // 用单位方向向量参与叉乘：|d|·|p-a| 的乘积在超大坐标下会溢出 double，
  // 先归一化方向可保证结果始终有限（数学上与 cross(d, p-a)/len 相同）。
  const ux = dx / len;
  const uy = dy / len;
  return ux * (p.y - a.y) - uy * (p.x - a.x);
}

/**
 * 点到线段的（无符号）距离，用于退化凸包（共线/重合）时的证据量化。
 */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return pointDistance(p, a);
  // 投影参数 t = ((p-a)·d)/|d|² 改写为 ((p-a)·û)/|d|，避免 |d|² 在超大坐标下溢出
  let t = ((p.x - a.x) * (dx / len) + (p.y - a.y) * (dy / len)) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * 归一化鞋带和：先以首顶点为基准平移（平移不改变简单多边形面积，且坐标差在
 * double 下精确），再按最大跨度归一化后累加。大幅平移（如 1e307 基准 + 1e292
 * 局部跨度）下平移项不会相互抵消吞掉真实面积；超大跨度不溢出、极小跨度不下溢。
 * 返回 { sum, scale }：sum 为 2 倍“归一化有符号面积”，符号与真实面积一致；
 * scale 为顶点最大跨度。空多边形或所有顶点重合（跨度为 0）时返回 null。
 */
function normalizedShoelace(poly) {
  if (poly.length === 0) return null;
  const ox = poly[0].x;
  const oy = poly[0].y;
  const rel = poly.map((p) => ({ x: p.x - ox, y: p.y - oy }));
  let scale = 0;
  for (const p of rel) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  let sum = 0;
  for (let i = 0; i < rel.length; i++) {
    const a = rel[i];
    const b = rel[(i + 1) % rel.length];
    sum += (a.x / scale) * (b.y / scale) - (b.x / scale) * (a.y / scale);
  }
  return { sum, scale };
}

export function polygonSignedArea(poly) {
  const r = normalizedShoelace(poly);
  if (r === null) return 0;
  // 还原真实面积：真实面积超出 double 范围时得到 ±Infinity、极小微观尺度下
  // 下溢为 0，均为可表达的最佳逼近；符号始终与真实面积一致。
  // 调用方（退化判断、定向）需要与量级无关的结果时应使用
  // polygonNormalizedSignedArea。
  return (r.sum / 2) * r.scale * r.scale;
}

/**
 * 归一化有符号面积：有符号面积除以顶点最大跨度的平方，与坐标量级和平移无关
 * （非退化多边形为 O(1) 量级，共线/重合时约为 0），符号与真实面积一致。
 * 供退化判断（ensureCCW、凸包退化检查）使用。
 */
export function polygonNormalizedSignedArea(poly) {
  const r = normalizedShoelace(poly);
  return r === null ? 0 : r.sum / 2;
}

/**
 * 保证多边形为逆时针方向。
 */
export function ensureCCW(poly) {
  return polygonNormalizedSignedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * 点到（逆时针）多边形边界的有符号距离：
 * 内部为正（到最近边的距离），外部为负。
 */
export function polygonSignedDistance(polyCCW, p) {
  let minAbs = Infinity;
  for (let i = 0; i < polyCCW.length; i++) {
    minAbs = Math.min(minAbs, lineSide(p, polyCCW[i], polyCCW[(i + 1) % polyCCW.length]));
  }
  return minAbs;
}

/**
 * 射线法点是否在多边形内（含边界）。
 */
export function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const onBoundary =
      crossDiffs(a.x - p.x, a.y - p.y, b.x - p.x, b.y - p.y) === 0 &&
      Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
    if (onBoundary) return true;
    // 先算纵向比例再乘回横差，避免 (b.x-a.x)*(p.y-a.y) 在超大坐标下溢出
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < a.x + (b.x - a.x) * ((p.y - a.y) / (b.y - a.y));
    if (intersects) inside = !inside;
  }
  return inside;
}

function dedupe(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * Andrew 单调链凸包，返回逆时针顶点序列，剔除共线中间点。
 * 点数不足时原样返回（去重后）。
 */
export function convexHull(points) {
  const pts = dedupe(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  // 转向判断用溢出安全的叉积，超大坐标下不会退化为 Infinity/NaN
  const cross3 = (o, a, b) =>
    crossDiffs(a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross3(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross3(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 点到逆时针凸包边界的最小有符号距离（各边有符号距离的最小值）。
 * 凸包退化（不足 3 个顶点）时返回 -Infinity。
 */
export function convexMargin(hullCCW, p) {
  if (hullCCW.length < 3) return -Infinity;
  let m = Infinity;
  for (let i = 0; i < hullCCW.length; i++) {
    m = Math.min(m, lineSide(p, hullCCW[i], hullCCW[(i + 1) % hullCCW.length]));
  }
  return m;
}
