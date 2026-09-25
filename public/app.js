// 前端逻辑：录入 -> POST /api/fixture-plans -> 渲染选点/凸包/偏差矩形四角裕量。
const RAIL_COLORS = ['#38bdf8', '#22d3ee', '#a78bfa', '#34d399'];
const RAIL_NAMES = ['导轨 1', '导轨 2', '导轨 3', '导轨 4'];

const EXAMPLE = {
  rails: [
    [[-7, -4], [-7, 0], [-7, 4], [-5, 0]],
    [[7, -4], [7, 0], [7, 4], [5, 0]],
    [[-3, -6], [0, -6], [3, -6], [0, -4]],
    [[-3, 6], [0, 6], [3, 6], [0, 4]],
  ],
  boundary: [[-10, -8], [10, -8], [10, 8], [-10, 8]],
  cg: [0, 0],
  toleranceX: 2,
  toleranceY: 2,
  minSpacing: 3,
};

const $ = (id) => document.getElementById(id);

function pointsToText(points) {
  return points.map(([x, y]) => `${x},${y}`).join('\n');
}

function loadExample() {
  EXAMPLE.rails.forEach((pts, i) => {
    $(`rail${i}`).value = pointsToText(pts);
  });
  $('boundary').value = pointsToText(EXAMPLE.boundary);
  $('cgX').value = EXAMPLE.cg[0];
  $('cgY').value = EXAMPLE.cg[1];
  $('tolX').value = EXAMPLE.toleranceX;
  $('tolY').value = EXAMPLE.toleranceY;
  $('minSpacing').value = EXAMPLE.minSpacing;
}

function parsePoints(text, label) {
  const out = [];
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/[,，\s]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error(`${label} 中无法解析的坐标：“${line}”，应为 x,y`);
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} 中存在非数值坐标：“${line}”`);
    out.push({ x, y });
  }
  return out;
}

function num(id, label) {
  const v = Number($(id).value);
  if (!Number.isFinite(v)) throw new Error(`${label} 必须是数值`);
  return v;
}

function buildPayload() {
  const rails = [];
  for (let i = 0; i < 4; i++) {
    const pts = parsePoints($(`rail${i}`).value, RAIL_NAMES[i]);
    if (pts.length === 0) throw new Error(`${RAIL_NAMES[i]} 至少需要一个候选点`);
    rails.push(pts);
  }
  const boundary = parsePoints($('boundary').value, '翼板批准边界');
  if (boundary.length < 3) throw new Error('翼板批准边界至少需要 3 个顶点');
  const toleranceX = num('tolX', '横向偏差');
  const toleranceY = num('tolY', '纵向偏差');
  const minSpacing = num('minSpacing', '最小间距');
  if (toleranceX < 0 || toleranceY < 0 || minSpacing < 0) {
    throw new Error('偏差与间距必须是非负数');
  }
  return {
    rails,
    boundary,
    cg: { x: num('cgX', '重心标称 X'), y: num('cgY', '重心标称 Y') },
    toleranceX,
    toleranceY,
    minSpacing,
  };
}

function fmt(v, d = 4) {
  return Number(v).toFixed(d).replace(/\.?0+$/, '');
}

function clearResults() {
  $('resultBody').hidden = true;
  $('resultEmpty').hidden = false;
  $('scene').innerHTML = '';
  $('selectionCards').innerHTML = '';
  $('cornerRows').innerHTML = '';
  $('metricsBox').innerHTML = '';
  $('statusBanner').className = '';
  $('statusBanner').innerHTML = '';
}

// ---------- SVG 绘制 ----------
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function makeTransform(payload, result) {
  const all = [
    ...payload.boundary,
    ...payload.rails.flat(),
    payload.cg,
    ...(result.evidence?.corners ?? result.corners ?? []),
  ];
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY, 1) * 1.15;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = 560;
  const scale = size / span;
  return {
    toX: (x) => 20 + (x - (cx - span / 2)) * scale,
    toY: (y) => 20 + ((cy + span / 2) - y) * scale,
    r: 4 + scale * 0.2,
  };
}

function drawScene(payload, result) {
  const svg = $('scene');
  svg.innerHTML = '';
  const t = makeTransform(payload, result);
  const P = (p) => `${t.toX(p.x)},${t.toY(p.y)}`;

  // 批准边界
  svg.appendChild(svgEl('polygon', {
    points: payload.boundary.map(P).join(' '),
    fill: 'rgba(148,163,184,0.06)',
    stroke: '#94a3b8',
    'stroke-width': 1.5,
    'stroke-dasharray': '6 4',
  }));

  // 全部候选点（淡色）
  payload.rails.forEach((pts, r) => {
    pts.forEach((p) => {
      svg.appendChild(svgEl('circle', {
        cx: t.toX(p.x), cy: t.toY(p.y), r: 3,
        fill: '#475569', stroke: RAIL_COLORS[r], 'stroke-width': 0.8,
      }));
    });
  });

  // 偏差矩形
  const { x: cx, y: cy } = payload.cg;
  const tx = payload.toleranceX;
  const ty = payload.toleranceY;
  const rectPts = [
    { x: cx - tx, y: cy - ty }, { x: cx + tx, y: cy - ty },
    { x: cx + tx, y: cy + ty }, { x: cx - tx, y: cy + ty },
  ];
  svg.appendChild(svgEl('polygon', {
    points: rectPts.map(P).join(' '),
    fill: 'rgba(251,191,36,0.08)',
    stroke: '#fbbf24',
    'stroke-width': 1.5,
    'stroke-dasharray': '4 3',
  }));

  // 支撑凸包
  const hull = result.hull ?? result.evidence?.hull;
  if (hull && hull.length >= 3) {
    svg.appendChild(svgEl('polygon', {
      points: hull.map(P).join(' '),
      fill: result.feasible ? 'rgba(56,189,248,0.14)' : 'rgba(248,113,113,0.12)',
      stroke: result.feasible ? '#38bdf8' : '#f87171',
      'stroke-width': 2,
    }));
  }

  // 已选支撑垫
  const sel = result.selection ?? [];
  sel.forEach((s) => {
    svg.appendChild(svgEl('circle', {
      cx: t.toX(s.x), cy: t.toY(s.y), r: 6.5,
      fill: RAIL_COLORS[s.rail], stroke: '#0b1220', 'stroke-width': 2,
    }));
    svg.appendChild(svgEl('text', {
      x: t.toX(s.x) + 9, y: t.toY(s.y) - 8,
      fill: RAIL_COLORS[s.rail], 'font-size': 11, 'font-weight': 700,
    }, `${s.rail + 1}-${s.candidateNumber}`));
  });

  // 失败证据中的点
  if (!result.feasible && result.evidence?.points) {
    result.evidence.points.forEach((p, r) => {
      svg.appendChild(svgEl('circle', {
        cx: t.toX(p.x), cy: t.toY(p.y), r: 6,
        fill: 'none', stroke: RAIL_COLORS[r], 'stroke-width': 2,
      }));
    });
  }

  // 标称重心十字
  svg.appendChild(svgEl('path', {
    d: `M ${t.toX(cx) - 7} ${t.toY(cy)} L ${t.toX(cx) + 7} ${t.toY(cy)}
        M ${t.toX(cx)} ${t.toY(cy) - 7} L ${t.toX(cx)} ${t.toY(cy) + 7}`,
    stroke: '#f472b6', 'stroke-width': 2,
  }));
  svg.appendChild(svgEl('text', {
    x: t.toX(cx) + 9, y: t.toY(cy) + 4,
    fill: '#f472b6', 'font-size': 11,
  }, '重心'));

  // 四角及裕量
  const corners = result.corners ?? result.evidence?.corners ?? [];
  corners.forEach((c) => {
    const ok = (c.margin ?? -Infinity) > 0;
    svg.appendChild(svgEl('circle', {
      cx: t.toX(c.x), cy: t.toY(c.y), r: 4.5,
      fill: c.margin === undefined ? '#fbbf24' : ok ? '#34d399' : '#f87171',
      stroke: '#0b1220', 'stroke-width': 1.5,
    }));
    if (c.margin !== undefined) {
      svg.appendChild(svgEl('text', {
        x: t.toX(c.x) + 6, y: t.toY(c.y) + 14,
        fill: ok ? '#34d399' : '#f87171', 'font-size': 10,
      }, fmt(c.margin, 3)));
    }
  });
}

// ---------- 结果渲染 ----------
function renderSuccess(payload, result) {
  $('resultEmpty').hidden = true;
  $('resultBody').hidden = false;
  const banner = $('statusBanner');
  banner.className = 'ok';
  banner.innerHTML = `✓ 存在可行方案：方案在 ${result.evaluatedCombinations} 个完整组合中裁决产生
    <small>候选编号序列（按导轨顺序）：[${result.metrics.indices.map((i) => i + 1).join(', ')}]</small>`;

  $('selectionCards').innerHTML = '';
  result.selection.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="rail-name" style="color:${RAIL_COLORS[s.rail]}">${RAIL_NAMES[s.rail]}</div>
      <div class="pick">选用第 <b>${s.candidateNumber}</b> 个候选点</div>
      <div class="coord">(${fmt(s.x)}, ${fmt(s.y)})</div>`;
    $('selectionCards').appendChild(card);
  });

  $('metricsBox').innerHTML = `
    <span class="metric">四角最小有符号距离 <b>${fmt(result.metrics.minMargin)}</b></span>
    <span class="metric">四垫到重心距离和 <b>${fmt(result.metrics.sumDistance)}</b></span>
    <span class="metric">垫间最小间距 <b>${fmt(result.metrics.minGap)}</b></span>
    <span class="metric">枚举组合数 <b>${result.evaluatedCombinations}</b></span>`;

  const rows = $('cornerRows');
  rows.innerHTML = '';
  result.corners.forEach((c) => {
    const tr = document.createElement('tr');
    tr.className = 'ok';
    tr.innerHTML = `<td>${c.label}</td><td>${fmt(c.x)}</td><td>${fmt(c.y)}</td>
      <td>${fmt(c.margin)}</td><td>严格在内 ✓</td>`;
    rows.appendChild(tr);
  });

  drawScene(payload, result);
}

function renderFailure(payload, result) {
  $('resultEmpty').hidden = true;
  $('resultBody').hidden = false;
  const banner = $('statusBanner');
  banner.className = 'bad';
  banner.innerHTML = `✗ 无可行方案：${result.message}
    <small>已枚举 ${result.evaluatedCombinations} 个完整组合；下图展示最接近满足约束的组合证据。</small>`;

  $('selectionCards').innerHTML = '';
  if (result.evidence) {
    result.evidence.points.forEach((p, r) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="rail-name" style="color:${RAIL_COLORS[r]}">${RAIL_NAMES[r]}</div>
        <div class="pick">候选 <b>${result.evidence.candidateNumbers[r]}</b>（证据组合）</div>
        <div class="coord">(${fmt(p.x)}, ${fmt(p.y)})</div>`;
      $('selectionCards').appendChild(card);
    });

    $('metricsBox').innerHTML = `
      <span class="metric">失败环节 <b>${result.evidence.status}</b></span>
      <span class="metric">违约缺口 <b>${fmt(result.evidence.deficit)}</b></span>
      <span class="metric">证据编号序列 [${result.evidence.candidateNumbers.join(', ')}]</span>`;

    const rows = $('cornerRows');
    rows.innerHTML = '';
    const corners = result.evidence.cornerResults ?? result.evidence.corners ?? [];
    corners.forEach((c) => {
      const tr = document.createElement('tr');
      const hasMargin = typeof c.margin === 'number';
      const ok = hasMargin && c.margin > 0;
      tr.className = ok ? 'ok' : 'bad';
      tr.innerHTML = `<td>${c.label ?? '角点'}</td><td>${fmt(c.x)}</td><td>${fmt(c.y)}</td>
        <td>${hasMargin ? fmt(c.margin) : '—（凸包退化）'}</td>
        <td>${ok ? '在内 ✓' : '越界/不可判定 ✗'}</td>`;
      rows.appendChild(tr);
    });
  }

  drawScene(payload, result);
}

async function generate() {
  $('formError').hidden = true;
  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    $('formError').textContent = err.message;
    $('formError').hidden = false;
    return;
  }

  // 请求新结果前撤下旧结果
  clearResults();
  $('generateBtn').disabled = true;

  try {
    const resp = await fetch('/api/fixture-plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!resp.ok) {
      throw new Error(result.detail || result.error || `服务返回 ${resp.status}`);
    }
    if (result.feasible) renderSuccess(payload, result);
    else renderFailure(payload, result);
  } catch (err) {
    clearResults();
    $('formError').textContent = `联调失败：${err.message}`;
    $('formError').hidden = false;
  } finally {
    $('generateBtn').disabled = false;
  }
}

// ---------- 初始化 ----------
for (let i = 0; i < 4; i++) {
  const wrap = document.createElement('div');
  wrap.className = 'rail-block';
  wrap.innerHTML = `<label for="rail${i}">${RAIL_NAMES[i]} 候选点（每行 x,y）</label>
    <textarea id="rail${i}" rows="5"></textarea>`;
  $('railInputs').appendChild(wrap);
}
loadExample();
$('generateBtn').addEventListener('click', generate);
$('resetBtn').addEventListener('click', () => {
  loadExample();
  $('formError').hidden = true;
  clearResults();
});
