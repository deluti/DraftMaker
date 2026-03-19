/* ══════════════════════════════════════════════
   DraftCraft v3.1 — script.js
   ══════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── CANVAS SETUP ───────────────────────────────────────────────────────────
  const mainCanvas    = document.getElementById('mainCanvas');
  const ctx           = mainCanvas.getContext('2d');
  const canvasWrap    = document.getElementById('canvasWrap');
  const minimapCanvas = document.getElementById('minimapCanvas');
  const mmCtx         = minimapCanvas.getContext('2d');

  function resizeCanvas() {
    const r = canvasWrap.getBoundingClientRect();
    mainCanvas.width  = r.width;
    mainCanvas.height = r.height;
    render();
  }
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 50);

  // ─── CONSTANTS ──────────────────────────────────────────────────────────────
  const GRID        = 30;
  const BASE_LW     = 2;   // base line width in screen pixels (zoom-independent)
  const BASE_BOLD   = 5;
  const BASE_DOUBLE = 1.5;

  // ─── STATE ──────────────────────────────────────────────────────────────────
  let snapEnabled      = true;
  let showGrid         = true;
  let theme            = 'dark';
  let currentTool      = 'select';
  let currentColor     = '#4f8ef7';
  let currentLineStyle = 'solid';
  let currentArrowStyle= 'arrow';

  let camera = { x: 0, y: 0, zoom: 1, minZoom: 0.08, maxZoom: 8 };
  let isPanning  = false;
  let lastMouse  = { x: 0, y: 0 };

  let elements    = [];
  let selectedEl  = null;
  let selectedIdx = -1;

  let history = [];
  let histIdx = -1;
  const MAX_HIST = 60;

  let drawing  = false;
  let tempEl   = null;
  let startPt  = null;
  let arcPts   = [];
  let arrowPts = [];

  // ─── COORDINATE TRANSFORMS ──────────────────────────────────────────────────
  function screenToWorld(sx, sy) {
    return {
      x: (sx - mainCanvas.width  / 2) / camera.zoom + camera.x,
      y: (sy - mainCanvas.height / 2) / camera.zoom + camera.y,
    };
  }
  function worldToScreen(wx, wy) {
    return {
      x: (wx - camera.x) * camera.zoom + mainCanvas.width  / 2,
      y: (wy - camera.y) * camera.zoom + mainCanvas.height / 2,
    };
  }
  function snapPt(pt) {
    if (!snapEnabled) return pt;
    return { x: Math.round(pt.x / GRID) * GRID, y: Math.round(pt.y / GRID) * GRID };
  }
  function getWorld(e, doSnap = true) {
    const r  = mainCanvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (mainCanvas.width  / r.width);
    const sy = (e.clientY - r.top)  * (mainCanvas.height / r.height);
    const w  = screenToWorld(sx, sy);
    return doSnap ? snapPt(w) : w;
  }

  // ─── HISTORY ────────────────────────────────────────────────────────────────
  function saveHistory() {
    if (histIdx < history.length - 1) history = history.slice(0, histIdx + 1);
    history.push(JSON.parse(JSON.stringify(elements)));
    if (history.length > MAX_HIST) history.shift();
    histIdx = history.length - 1;
    updateUI();
  }
  function undo() {
    if (histIdx > 0) {
      histIdx--;
      elements = JSON.parse(JSON.stringify(history[histIdx]));
      deselect(); render(); updateUI();
    }
  }
  function redo() {
    if (histIdx < history.length - 1) {
      histIdx++;
      elements = JSON.parse(JSON.stringify(history[histIdx]));
      deselect(); render(); updateUI();
    }
  }
  function deselect() {
    selectedEl  = null;
    selectedIdx = -1;
    document.getElementById('editSection').style.display = 'none';
    updateInspector(null);
  }

  // ─── DRAW STYLE ─────────────────────────────────────────────────────────────
  /**
   * Line widths are set in SCREEN pixels (constant regardless of zoom).
   * We draw in screen-space after worldToScreen(), so lineWidth in ctx
   * is already in screen pixels — no division by zoom needed.
   * Exception: dash patterns must scale with zoom so they look consistent
   * in world-space.
   */
  function applyStyle(el) {
    ctx.strokeStyle = el.color || '#fff';
    ctx.fillStyle   = el.color || '#fff';
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);

    switch (el.lineStyle) {
      case 'dashed':
        ctx.lineWidth = BASE_LW;
        ctx.setLineDash([12, 7]);
        break;
      case 'dotted':
        ctx.lineWidth = BASE_LW;
        ctx.setLineDash([2, 7]);
        break;
      case 'bold':
        ctx.lineWidth = BASE_BOLD;
        break;
      case 'double':
        ctx.lineWidth = BASE_DOUBLE;
        break;
      default: // solid
        ctx.lineWidth = BASE_LW;
    }
  }

  function drawArrowHead(fromX, fromY, toX, toY) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const len   = 14; // screen pixels — constant size
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - len * Math.cos(angle - 0.42), toY - len * Math.sin(angle - 0.42));
    ctx.lineTo(toX - len * Math.cos(angle + 0.42), toY - len * Math.sin(angle + 0.42));
    ctx.closePath();
    ctx.fill();
  }

  // ─── ELEMENT DRAWING ────────────────────────────────────────────────────────
  function drawElement(el, isTemp) {
    ctx.save();
    applyStyle(el);
    ctx.globalAlpha = isTemp ? 0.6 : 1;

    if (selectedEl === el && !isTemp) {
      ctx.shadowColor  = '#4f8ef7';
      ctx.shadowBlur   = 16;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    switch (el.type) {

      case 'line': {
        const p1 = worldToScreen(el.x1, el.y1);
        const p2 = worldToScreen(el.x2, el.y2);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        // double-line offset in screen space
        if (el.lineStyle === 'double') {
          const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) + Math.PI / 2;
          const off = 4;
          ctx.beginPath();
          ctx.moveTo(p1.x + Math.cos(ang)*off, p1.y + Math.sin(ang)*off);
          ctx.lineTo(p2.x + Math.cos(ang)*off, p2.y + Math.sin(ang)*off);
          ctx.stroke();
        }
        break;
      }

      case 'rect': {
        const tl = worldToScreen(el.x,        el.y);
        const br = worldToScreen(el.x + el.w, el.y + el.h);
        ctx.beginPath(); ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.stroke();
        break;
      }

      case 'ellipse': {
        const center = worldToScreen(el.cx, el.cy);
        const rx = Math.abs(el.rx * camera.zoom);
        const ry = Math.abs(el.ry * camera.zoom);
        ctx.beginPath(); ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      }

      case 'arc': {
        const a1 = worldToScreen(el.p1.x, el.p1.y);
        const a2 = worldToScreen(el.p2.x, el.p2.y);
        const a3 = worldToScreen(el.p3.x, el.p3.y);
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.quadraticCurveTo(a2.x, a2.y, a3.x, a3.y); ctx.stroke();
        break;
      }

      case 'text': {
        const tp = worldToScreen(el.x, el.y);
        // font size scales with zoom so text stays "attached" to world
        const fs = Math.max(8, 16 * camera.zoom);
        ctx.font      = `${el.italic ? 'italic ' : ''}${fs}px 'DM Sans', sans-serif`;
        ctx.fillStyle = el.color;
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.fillText(el.text, tp.x, tp.y);
        if (selectedEl === el) {
          const tw = ctx.measureText(el.text).width;
          ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(tp.x - 2, tp.y - fs * 0.9, tw + 4, fs * 1.2);
          ctx.setLineDash([]);
        }
        break;
      }

      case 'arrow': {
        if (el.points.length < 2) break;
        ctx.setLineDash([]);
        if (el.lineStyle === 'dashed') ctx.setLineDash([12, 7]);
        if (el.lineStyle === 'dotted') ctx.setLineDash([2, 7]);

        const screenPts = el.points.map(p => worldToScreen(p.x, p.y));

        // Line path
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Route waypoint dots
        if (el.arrowStyle === 'route') {
          for (let i = 1; i < screenPts.length - 1; i++) {
            ctx.beginPath();
            ctx.arc(screenPts[i].x, screenPts[i].y, 5, 0, Math.PI * 2);
            ctx.fillStyle      = el.color;
            ctx.shadowColor    = 'transparent'; ctx.shadowBlur = 0;
            ctx.fill();
          }
        }

        // Arrow head(s)
        const n    = screenPts.length;
        ctx.fillStyle   = el.color;
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        drawArrowHead(screenPts[n-2].x, screenPts[n-2].y, screenPts[n-1].x, screenPts[n-1].y);

        if (el.arrowStyle === 'arrow2') {
          drawArrowHead(screenPts[1].x, screenPts[1].y, screenPts[0].x, screenPts[0].y);
        }

        // Origin dot
        ctx.beginPath();
        ctx.arc(screenPts[0].x, screenPts[0].y, 4, 0, Math.PI * 2);
        ctx.fillStyle = el.color; ctx.fill();
        break;
      }

      case 'zone': {
        if (!el.points || el.points.length < 2) break;
        const pts = el.points.map(p => worldToScreen(p.x, p.y));
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(el.color, el.opacity || 0.2);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.fill();
        ctx.stroke();
        break;
      }
    }

    // Label rendering
    if (el.label && el.type !== 'text') {
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      const labelFs = Math.max(9, 12 * camera.zoom);
      ctx.font      = `${labelFs}px 'DM Sans', sans-serif`;
      ctx.fillStyle = el.color;
      ctx.globalAlpha = 0.9;

      let lx = 0, ly = 0;
      switch (el.type) {
        case 'line': {
          const m = worldToScreen((el.x1+el.x2)/2, (el.y1+el.y2)/2);
          lx = m.x; ly = m.y - 8; break;
        }
        case 'rect': {
          const c = worldToScreen(el.x + el.w/2, el.y + el.h/2);
          lx = c.x; ly = c.y; break;
        }
        case 'ellipse': {
          const c = worldToScreen(el.cx, el.cy);
          lx = c.x; ly = c.y; break;
        }
        case 'arrow': {
          const mi = Math.floor(el.points.length / 2);
          const m  = worldToScreen(el.points[mi].x, el.points[mi].y);
          lx = m.x + 6; ly = m.y - 8; break;
        }
        case 'zone': {
          const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
          const c  = worldToScreen(
            (Math.min(...xs)+Math.max(...xs))/2,
            (Math.min(...ys)+Math.max(...ys))/2
          );
          lx = c.x; ly = c.y; break;
        }
      }
      ctx.fillText(el.label, lx, ly);
    }

    ctx.restore();
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ─── HIT TESTING ────────────────────────────────────────────────────────────
  function hitTest(wx, wy, el) {
    const tol = 8 / camera.zoom; // world-space tolerance
    switch (el.type) {
      case 'line':
        return ptToSegDist(wx, wy, el.x1, el.y1, el.x2, el.y2) < tol;
      case 'rect':
        return wx >= el.x - tol && wx <= el.x + el.w + tol &&
               wy >= el.y - tol && wy <= el.y + el.h + tol;
      case 'ellipse':
        return Math.abs((wx-el.cx)**2/((el.rx||1)**2) + (wy-el.cy)**2/((el.ry||1)**2) - 1) < 0.4;
      case 'arc': {
        const xs=[el.p1.x,el.p2.x,el.p3.x], ys=[el.p1.y,el.p2.y,el.p3.y];
        return wx>=Math.min(...xs)-tol&&wx<=Math.max(...xs)+tol&&
               wy>=Math.min(...ys)-tol&&wy<=Math.max(...ys)+tol;
      }
      case 'text':
        return wx>=el.x-tol && wx<=el.x+el.text.length*9/camera.zoom+tol &&
               wy>=el.y-18/camera.zoom && wy<=el.y+4/camera.zoom;
      case 'arrow':
        for (let i=0;i<el.points.length-1;i++) {
          if (ptToSegDist(wx,wy,el.points[i].x,el.points[i].y,el.points[i+1].x,el.points[i+1].y) < tol)
            return true;
        }
        return false;
      case 'zone':
        return el.points && el.points.length >= 3 && pointInPolygon(wx, wy, el.points);
    }
    return false;
  }

  function ptToSegDist(px, py, x1, y1, x2, y2) {
    const A=px-x1, B=py-y1, C=x2-x1, D=y2-y1;
    const dot=A*C+B*D, len=C*C+D*D;
    const t = len===0 ? 0 : Math.max(0, Math.min(1, dot/len));
    return Math.hypot(px-(x1+t*C), py-(y1+t*D));
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i=0, j=pts.length-1; i<pts.length; j=i++) {
      if ((pts[i].y>py) !== (pts[j].y>py) &&
          px < (pts[j].x-pts[i].x)*(py-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x)
        inside = !inside;
    }
    return inside;
  }

  // ─── GRID & RENDER ──────────────────────────────────────────────────────────
  function drawGrid() {
    const style    = getComputedStyle(document.body);
    const canvasBg = style.getPropertyValue('--canvas-bg').trim();
    ctx.fillStyle  = canvasBg;
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    if (!showGrid) return;

    const lw = screenToWorld(0, 0);
    const rb = screenToWorld(mainCanvas.width, mainCanvas.height);
    const sx = Math.floor(lw.x / GRID) * GRID;
    const sy = Math.floor(lw.y / GRID) * GRID;
    const ex = Math.ceil(rb.x  / GRID) * GRID;
    const ey = Math.ceil(rb.y  / GRID) * GRID;

    const minor = style.getPropertyValue('--grid-minor').trim();
    const major = style.getPropertyValue('--grid-major').trim();

    // Minor grid lines — constant 0.8px on screen
    ctx.lineWidth = 0.8;
    for (let x = sx; x <= ex; x += GRID) {
      if (x % (GRID * 5) === 0) continue;
      const s = worldToScreen(x, 0);
      ctx.strokeStyle = minor;
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, mainCanvas.height); ctx.stroke();
    }
    for (let y = sy; y <= ey; y += GRID) {
      if (y % (GRID * 5) === 0) continue;
      const s = worldToScreen(0, y);
      ctx.strokeStyle = minor;
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(mainCanvas.width, s.y); ctx.stroke();
    }

    // Major grid lines — 1.2px on screen
    ctx.lineWidth = 1.2;
    for (let x = sx; x <= ex; x += GRID) {
      if (x % (GRID * 5) !== 0) continue;
      const s = worldToScreen(x, 0);
      ctx.strokeStyle = major;
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, mainCanvas.height); ctx.stroke();
    }
    for (let y = sy; y <= ey; y += GRID) {
      if (y % (GRID * 5) !== 0) continue;
      const s = worldToScreen(0, y);
      ctx.strokeStyle = major;
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(mainCanvas.width, s.y); ctx.stroke();
    }

    // Origin cross — always constant 1.5px
    const orig = worldToScreen(0, 0);
    const acc  = style.getPropertyValue('--accent').trim();
    ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.45;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(orig.x-15, orig.y); ctx.lineTo(orig.x+15, orig.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(orig.x, orig.y-15); ctx.lineTo(orig.x, orig.y+15); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function drawTempArrowPreview() {
    if (arrowPts.length === 0) return;
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth   = BASE_LW;
    ctx.setLineDash([6, 4]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const sp = worldToScreen(arrowPts[0].x, arrowPts[0].y);
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
    for (let i = 1; i < arrowPts.length; i++) {
      const p = worldToScreen(arrowPts[i].x, arrowPts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    arrowPts.forEach((pt, i) => {
      const s = worldToScreen(pt.x, pt.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, i === 0 ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = currentColor; ctx.globalAlpha = 0.85;
      ctx.fill();
    });
    ctx.restore();
  }

  function drawTempArcPreview() {
    if (arcPts.length === 0) return;
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth   = BASE_LW;
    ctx.setLineDash([6, 4]);
    ctx.lineCap = 'round';

    const p0 = worldToScreen(arcPts[0].x, arcPts[0].y);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < arcPts.length; i++) {
      const p = worldToScreen(arcPts[i].x, arcPts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    arcPts.forEach(p => {
      const s = worldToScreen(p.x, p.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = currentColor; ctx.globalAlpha = 0.85; ctx.fill();
    });
    ctx.restore();
  }

  function drawHandles(el) {
    const pts = getBoundingPts(el);
    if (!pts) return;
    ctx.save();
    ctx.strokeStyle = '#4f8ef7';
    ctx.fillStyle   = '#fff';
    ctx.lineWidth   = 1.5;
    pts.forEach(p => {
      const s = worldToScreen(p.x, p.y);
      ctx.beginPath();
      ctx.rect(s.x - 4, s.y - 4, 8, 8);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }

  function getBoundingPts(el) {
    switch (el.type) {
      case 'line':    return [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }];
      case 'rect':    return [
        { x: el.x,        y: el.y        },
        { x: el.x + el.w, y: el.y        },
        { x: el.x + el.w, y: el.y + el.h },
        { x: el.x,        y: el.y + el.h },
      ];
      case 'ellipse': return [
        { x: el.cx - el.rx, y: el.cy       },
        { x: el.cx + el.rx, y: el.cy       },
        { x: el.cx,         y: el.cy-el.ry },
        { x: el.cx,         y: el.cy+el.ry },
      ];
      case 'arc':     return [el.p1, el.p2, el.p3];
      case 'arrow':   return el.points;
      case 'zone':    return el.points;
      default:        return null;
    }
  }

  function render() {
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    drawGrid();

    elements.forEach(el => drawElement(el, false));
    if (tempEl) drawElement(tempEl, true);
    drawTempArcPreview();
    drawTempArrowPreview();
    if (selectedEl) drawHandles(selectedEl);

    renderMinimap();
  }

  // ─── MINIMAP ────────────────────────────────────────────────────────────────
  function renderMinimap() {
    mmCtx.clearRect(0, 0, 140, 90);
    const style = getComputedStyle(document.body);
    mmCtx.fillStyle = style.getPropertyValue('--bg3').trim() || '#1e2330';
    mmCtx.fillRect(0, 0, 140, 90);

    if (elements.length === 0) return;

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    elements.forEach(el => {
      getElPoints(el).forEach(p => {
        minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
      });
    });
    const pad = 60;
    minX-=pad; maxX+=pad; minY-=pad; maxY+=pad;
    const wW = maxX-minX || 1, wH = maxY-minY || 1;
    const sc = Math.min(140/wW, 90/wH) * 0.85;
    const ox = 70  - (minX + wW/2) * sc;
    const oy = 45  - (minY + wH/2) * sc;

    elements.forEach(el => {
      const pts = getElPoints(el);
      if (pts.length < 1) return;
      mmCtx.strokeStyle = el.color || '#4f8ef7';
      mmCtx.lineWidth   = 1;
      mmCtx.globalAlpha = 0.7;
      mmCtx.beginPath();
      mmCtx.moveTo(pts[0].x*sc+ox, pts[0].y*sc+oy);
      for (let i=1; i<pts.length; i++) mmCtx.lineTo(pts[i].x*sc+ox, pts[i].y*sc+oy);
      mmCtx.stroke();
    });

    // Viewport rect
    const tl = screenToWorld(0, 0), br = screenToWorld(mainCanvas.width, mainCanvas.height);
    mmCtx.globalAlpha = 0.55;
    mmCtx.strokeStyle = '#4f8ef7';
    mmCtx.lineWidth   = 1.5;
    mmCtx.strokeRect(
      tl.x*sc+ox, tl.y*sc+oy,
      (br.x-tl.x)*sc, (br.y-tl.y)*sc
    );
    mmCtx.globalAlpha = 1;
  }

  function getElPoints(el) {
    switch (el.type) {
      case 'line':    return [{ x:el.x1, y:el.y1 }, { x:el.x2, y:el.y2 }];
      case 'rect':    return [{ x:el.x, y:el.y }, { x:el.x+el.w, y:el.y+el.h }];
      case 'ellipse': return [{ x:el.cx-el.rx, y:el.cy-el.ry }, { x:el.cx+el.rx, y:el.cy+el.ry }];
      case 'arc':     return [el.p1, el.p2, el.p3];
      case 'text':    return [{ x:el.x, y:el.y }];
      case 'arrow':   return el.points || [];
      case 'zone':    return el.points || [];
      default:        return [];
    }
  }

  // ─── UI UPDATES ─────────────────────────────────────────────────────────────
  function updateUI() {
    document.getElementById('elCount').textContent = elements.length;
    document.getElementById('sbCount').textContent = elements.length;
    const pct = Math.round(camera.zoom * 100) + '%';
    document.getElementById('sbZoom').textContent   = pct;
    document.getElementById('zoomLabel').textContent = pct;
    document.getElementById('sbSnap').textContent   = 'Сетка: ' + (snapEnabled ? 'вкл' : 'выкл');
    updateElList();
  }

  function updateElList() {
    const list = document.getElementById('elList');
    list.innerHTML = '';
    elements.forEach((el, i) => {
      const div = document.createElement('div');
      div.className = 'el-item' + (selectedEl === el ? ' selected' : '');
      div.innerHTML = `
        <div class="el-dot" style="background:${el.color||'#888'}"></div>
        <span class="el-name">${el.label || (elTypeName(el.type) + ' ' + (i+1))}</span>
        <span class="el-del" data-idx="${i}">✕</span>`;
      div.querySelector('.el-name').addEventListener('click', () => selectEl(i));
      div.querySelector('.el-del').addEventListener('click', e => { e.stopPropagation(); deleteEl(i); });
      list.appendChild(div);
    });
  }

  function elTypeName(t) {
    const names = {
      select:'Объект', line:'Линия', rect:'Прямоуг.', ellipse:'Эллипс',
      arc:'Дуга', text:'Текст', arrow:'Стрелка', zone:'Зона'
    };
    return names[t] || t;
  }

  function selectEl(i) {
    selectedEl  = elements[i];
    selectedIdx = i;
    showEditPanel(elements[i]);
    updateElList();
    updateInspector(elements[i]);
    render();
  }

  function deleteEl(i) {
    elements.splice(i, 1);
    if (selectedIdx === i) deselect();
    else if (selectedIdx > i) selectedIdx--;
    saveHistory(); render(); updateUI();
  }

  function showEditPanel(el) {
    document.getElementById('editSection').style.display = 'block';
    document.getElementById('editColor').value  = el.color     || '#4f8ef7';
    document.getElementById('editStyle').value  = el.lineStyle || 'solid';
    document.getElementById('editArrowRow').style.display = el.type === 'arrow' ? 'flex' : 'none';
    if (el.type === 'arrow') document.getElementById('editArrowStyle').value = el.arrowStyle || 'arrow';
    document.getElementById('editTextRow').style.display = el.type === 'text'  ? 'flex' : 'none';
    if (el.type === 'text')  document.getElementById('editText').value        = el.text       || '';
    document.getElementById('editZoneRow').style.display = el.type === 'zone'  ? 'flex' : 'none';
    if (el.type === 'zone')  document.getElementById('editOpacity').value     = Math.round((el.opacity||0.2)*100);
    document.getElementById('editLabel').value = el.label || '';
  }

  function updateInspector(el) {
    if (!el) {
      ['inspX','inspY','inspW','inspH'].forEach(id => document.getElementById(id).textContent = '—');
      return;
    }
    const pts = getElPoints(el);
    if (!pts.length) return;
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
    const minX=Math.min(...xs), minY=Math.min(...ys);
    document.getElementById('inspX').textContent = Math.round(minX);
    document.getElementById('inspY').textContent = Math.round(minY);
    document.getElementById('inspW').textContent = Math.round(Math.max(...xs)-minX);
    document.getElementById('inspH').textContent = Math.round(Math.max(...ys)-minY);
  }

  function showHint(msg) {
    const h = document.getElementById('drawHint');
    h.textContent = msg; h.classList.add('visible');
  }
  function hideHint() {
    document.getElementById('drawHint').classList.remove('visible');
  }

  const TOOL_HINTS = {
    select:  'Кликните объект для выбора · Escape — снять выделение',
    line:    'Нажмите и тяните для линии',
    rect:    'Нажмите и тяните для прямоугольника',
    ellipse: 'Нажмите и тяните для эллипса',
    arc:     'Клик 1: начало · Клик 2: контрольная точка · Клик 3: конец',
    text:    'Кликните на холсте для добавления текста',
    arrow:   'Клики — точки маршрута · Двойной клик — завершить',
    zone:    'Клики — вершины зоны · Двойной клик — завершить',
  };

  // ─── ZOOM HELPERS ───────────────────────────────────────────────────────────
  function setZoom(newZoom) {
    camera.zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, newZoom));
    const pct = Math.round(camera.zoom * 100) + '%';
    document.getElementById('zoomLabel').textContent = pct;
    document.getElementById('sbZoom').textContent    = pct;
    render();
  }

  // ─── MOUSE EVENTS ───────────────────────────────────────────────────────────
  mainCanvas.addEventListener('mousedown', e => {
    e.preventDefault();
    const wPos    = getWorld(e, snapEnabled);
    const wPosRaw = getWorld(e, false);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      lastMouse = { x: e.clientX, y: e.clientY };
      canvasWrap.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    if (currentTool === 'select') {
      for (let i = elements.length-1; i >= 0; i--) {
        if (hitTest(wPosRaw.x, wPosRaw.y, elements[i])) { selectEl(i); return; }
      }
      deselect(); render(); return;
    }

    if (currentTool === 'text') {
      const t = prompt('Введите текст:', '');
      if (t) {
        elements.push({ type:'text', text:t, x:wPos.x, y:wPos.y, color:currentColor, lineStyle:currentLineStyle });
        saveHistory(); render(); updateUI();
      }
      return;
    }

    if (currentTool === 'arrow' || currentTool === 'zone') {
      if (!drawing) { drawing = true; arrowPts = [{ ...wPos }]; }
      else          { arrowPts.push({ ...wPos }); }
      render(); return;
    }

    if (currentTool === 'arc') {
      if (!drawing) { drawing = true; arcPts = [{ ...wPos }]; }
      else {
        arcPts.push({ ...wPos });
        if (arcPts.length === 3) {
          elements.push({ type:'arc', p1:{...arcPts[0]}, p2:{...arcPts[1]}, p3:{...arcPts[2]}, color:currentColor, lineStyle:currentLineStyle });
          drawing = false; arcPts = []; tempEl = null;
          saveHistory(); render(); updateUI();
        }
      }
      render(); return;
    }

    startPt  = { ...wPos };
    drawing  = true;

    if (currentTool === 'line') {
      tempEl = { type:'line', x1:wPos.x, y1:wPos.y, x2:wPos.x, y2:wPos.y, color:currentColor, lineStyle:currentLineStyle };
    } else if (currentTool === 'rect') {
      tempEl = { type:'rect', x:wPos.x, y:wPos.y, w:0, h:0, color:currentColor, lineStyle:currentLineStyle };
    } else if (currentTool === 'ellipse') {
      tempEl = { type:'ellipse', cx:wPos.x, cy:wPos.y, rx:0, ry:0, color:currentColor, lineStyle:currentLineStyle };
    }
    render();
  });

  mainCanvas.addEventListener('mousemove', e => {
    const wRaw = getWorld(e, false);
    document.getElementById('hudX').textContent = Math.round(wRaw.x);
    document.getElementById('hudY').textContent = Math.round(wRaw.y);

    if (isPanning) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      lastMouse = { x: e.clientX, y: e.clientY };
      render(); return;
    }

    if (!drawing || !tempEl) return;

    const wPos = getWorld(e, snapEnabled);
    if (tempEl.type === 'line') {
      tempEl.x2 = wPos.x; tempEl.y2 = wPos.y;
    } else if (tempEl.type === 'rect') {
      tempEl.w = wPos.x - startPt.x; tempEl.h = wPos.y - startPt.y;
    } else if (tempEl.type === 'ellipse') {
      tempEl.rx = Math.abs(wPos.x - startPt.x) / 2;
      tempEl.ry = Math.abs(wPos.y - startPt.y) / 2;
      tempEl.cx = startPt.x + (wPos.x - startPt.x) / 2;
      tempEl.cy = startPt.y + (wPos.y - startPt.y) / 2;
    }
    render();
  });

  mainCanvas.addEventListener('mouseup', e => {
    if (isPanning) {
      isPanning = false;
      canvasWrap.style.cursor = 'crosshair';
      return;
    }
    if (!drawing || currentTool==='arrow' || currentTool==='zone' || currentTool==='arc') return;

    if (tempEl) {
      let valid = false;
      if      (tempEl.type==='line')    valid = Math.hypot(tempEl.x2-tempEl.x1, tempEl.y2-tempEl.y1) > 3;
      else if (tempEl.type==='rect')    valid = Math.abs(tempEl.w)>3 && Math.abs(tempEl.h)>3;
      else if (tempEl.type==='ellipse') valid = tempEl.rx>2 && tempEl.ry>2;
      if (valid) { elements.push({ ...tempEl }); saveHistory(); updateUI(); }
    }
    drawing = false; tempEl = null; render();
  });

  mainCanvas.addEventListener('dblclick', () => {
    if (currentTool === 'arrow' && drawing && arrowPts.length >= 2) {
      elements.push({ type:'arrow', points:[...arrowPts], color:currentColor, lineStyle:currentLineStyle, arrowStyle:currentArrowStyle });
      drawing = false; arrowPts = []; saveHistory(); render(); updateUI();
    }
    if (currentTool === 'zone' && drawing && arrowPts.length >= 3) {
      elements.push({ type:'zone', points:[...arrowPts], color:currentColor, lineStyle:currentLineStyle, opacity:0.2 });
      drawing = false; arrowPts = []; saveHistory(); render(); updateUI();
    }
  });

  mainCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r    = mainCanvas.getBoundingClientRect();
    const mx   = (e.clientX - r.left) * (mainCanvas.width  / r.width);
    const my   = (e.clientY - r.top)  * (mainCanvas.height / r.height);
    const before = screenToWorld(mx, my);
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    camera.zoom  = Math.min(camera.maxZoom, Math.max(camera.minZoom, camera.zoom * factor));
    const after  = screenToWorld(mx, my);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    const pct = Math.round(camera.zoom * 100) + '%';
    document.getElementById('zoomLabel').textContent = pct;
    document.getElementById('sbZoom').textContent    = pct;
    render();
  }, { passive: false });

  // ─── TOOLBAR LISTENERS ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      drawing = false; tempEl = null; arcPts = []; arrowPts = [];
      document.getElementById('arrowStyleSelect').style.display = currentTool === 'arrow' ? '' : 'none';
      showHint(TOOL_HINTS[currentTool] || '');
      setTimeout(hideHint, 3500);
      render();
    });
  });

  document.getElementById('colorInput').addEventListener('input', e => {
    currentColor = e.target.value;
    document.getElementById('colorHex').textContent = e.target.value;
  });
  document.getElementById('lineStyleSelect').addEventListener('change', e => currentLineStyle = e.target.value);
  document.getElementById('arrowStyleSelect').addEventListener('change', e => currentArrowStyle = e.target.value);

  // Quick colors
  document.querySelectorAll('.quick-color').forEach(el => {
    el.addEventListener('click', () => {
      currentColor = el.dataset.c;
      document.getElementById('colorInput').value = currentColor;
      document.getElementById('colorHex').textContent = currentColor;
    });
  });

  // Snap toggle
  const snapToggleEl = document.getElementById('snapToggle');
  document.getElementById('snapCheck').addEventListener('change', e => {
    snapEnabled = e.target.checked;
    snapToggleEl.classList.toggle('on', snapEnabled);
    document.getElementById('sbSnap').textContent = 'Сетка: ' + (snapEnabled ? 'вкл' : 'выкл');
  });
  snapToggleEl.addEventListener('click', () => {
    const cb = document.getElementById('snapCheck');
    cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
  });

  // Undo / Redo
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  // Zoom buttons
  document.getElementById('zoomInBtn').addEventListener('click',  () => setZoom(camera.zoom * 1.2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => setZoom(camera.zoom / 1.2));
  document.getElementById('resetViewBtn').addEventListener('click', () => {
    camera.x = 0; camera.y = 0; setZoom(1);
  });

  // Theme
  document.getElementById('themeBtn').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.body.className = theme === 'dark' ? 'theme-dark' : 'light';
    render();
  });

  // Grid visibility
  document.getElementById('gridVisBtn').addEventListener('click', () => {
    showGrid = !showGrid; render();
  });

  // Screenshot
  document.getElementById('saveScreenBtn').addEventListener('click', () => {
    const tmp = document.createElement('canvas');
    tmp.width = mainCanvas.width; tmp.height = mainCanvas.height;
    const tc = tmp.getContext('2d');
    tc.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim();
    tc.fillRect(0, 0, tmp.width, tmp.height);
    tc.drawImage(mainCanvas, 0, 0);
    const a = document.createElement('a');
    a.download = `draftcraft-${Date.now()}.png`;
    a.href = tmp.toDataURL('image/png'); a.click();
  });

  // Save project
  document.getElementById('saveFileBtn').addEventListener('click', () => {
    const data = JSON.stringify({ version: '3.1', elements }, null, 2);
    const b    = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(b);
    const a    = document.createElement('a');
    a.download = `project-${Date.now()}.draft`;
    a.href = url; a.click();
    URL.revokeObjectURL(url);
  });

  // Open project
  document.getElementById('openFileInput').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const p = JSON.parse(ev.target.result);
        if (p.elements) {
          elements = p.elements;
          deselect(); saveHistory(); render(); updateUI();
        } else alert('Неверный формат файла');
      } catch { alert('Ошибка чтения файла'); }
    };
    r.readAsText(f); e.target.value = '';
  });

  // Clear
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Очистить весь чертёж?')) {
      elements = []; deselect(); saveHistory(); render(); updateUI();
    }
  });

  // Apply edit
  document.getElementById('applyEditBtn').addEventListener('click', () => {
    if (!selectedEl) return;
    selectedEl.color     = document.getElementById('editColor').value;
    selectedEl.lineStyle = document.getElementById('editStyle').value;
    if (selectedEl.type === 'arrow') selectedEl.arrowStyle = document.getElementById('editArrowStyle').value;
    if (selectedEl.type === 'text')  {
      const t = document.getElementById('editText').value;
      if (t) selectedEl.text = t;
    }
    if (selectedEl.type === 'zone')  selectedEl.opacity = parseInt(document.getElementById('editOpacity').value) / 100;
    const lbl = document.getElementById('editLabel').value;
    if (lbl) selectedEl.label = lbl; else delete selectedEl.label;
    saveHistory(); render(); updateUI(); updateInspector(selectedEl);
  });

  // Delete
  document.getElementById('deleteBtn').addEventListener('click', () => {
    if (selectedIdx >= 0) deleteEl(selectedIdx);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key==='z') { e.preventDefault(); undo(); }
      else if (e.key==='y') { e.preventDefault(); redo(); }
      else if (e.key==='='||e.key==='+') { e.preventDefault(); setZoom(camera.zoom*1.2); }
      else if (e.key==='-') { e.preventDefault(); setZoom(camera.zoom/1.2); }
      return;
    }

    switch (e.key) {
      case 'Escape':
        drawing=false; tempEl=null; arcPts=[]; arrowPts=[];
        deselect(); render(); hideHint(); break;
      case 'Delete': case 'Backspace':
        if (selectedIdx >= 0) deleteEl(selectedIdx); break;
      case 'v': case 'V': document.querySelector('[data-tool="select"]').click();  break;
      case 'l': case 'L': document.querySelector('[data-tool="line"]').click();    break;
      case 'r': case 'R': document.querySelector('[data-tool="rect"]').click();    break;
      case 'e': case 'E': document.querySelector('[data-tool="ellipse"]').click(); break;
      case 'a': case 'A': document.querySelector('[data-tool="arc"]').click();     break;
      case 'w': case 'W': document.querySelector('[data-tool="arrow"]').click();   break;
      case 't': case 'T': document.querySelector('[data-tool="text"]').click();    break;
      case 'z': case 'Z': document.querySelector('[data-tool="zone"]').click();    break;
      case '0': camera.x=0; camera.y=0; setZoom(1); break;
    }
  });

  // ─── INIT ───────────────────────────────────────────────────────────────────
  saveHistory(); // empty initial state
  render();
  updateUI();

})();
