(function(){
'use strict';

// ─── CANVAS SETUP ───
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap');
const minimapCanvas = document.getElementById('minimapCanvas');
const mmCtx = minimapCanvas.getContext('2d');

function resizeCanvas() {
  const r = canvasWrap.getBoundingClientRect();
  mainCanvas.width = r.width;
  mainCanvas.height = r.height;
  render();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 50);

// ─── STATE ───
const GRID = 30;
let snapEnabled = true;
let showGrid = true;
let theme = 'dark';
let currentTool = 'select';
let currentColor = '#4f8ef7';
let currentLineStyle = 'solid';
let currentArrowStyle = 'arrow';

let camera = { x: 0, y: 0, zoom: 1, minZoom: 0.1, maxZoom: 5 };
let isPanning = false;
let lastMouse = { x: 0, y: 0 };
let mouseWorld = { x: 0, y: 0 };

let elements = [];
let selectedEl = null;
let selectedIdx = -1;

let history = [];
let histIdx = -1;
const MAX_HIST = 60;

let drawing = false;
let tempEl = null;
let startPt = null;
let arcPts = [];
let arrowPts = [];

// ─── COORD TRANSFORMS ───
function screenToWorld(sx, sy) {
  return {
    x: (sx - mainCanvas.width/2) / camera.zoom + camera.x,
    y: (sy - mainCanvas.height/2) / camera.zoom + camera.y
  };
}
function worldToScreen(wx, wy) {
  return {
    x: (wx - camera.x) * camera.zoom + mainCanvas.width/2,
    y: (wy - camera.y) * camera.zoom + mainCanvas.height/2
  };
}
function snap(pt) {
  if (!snapEnabled) return pt;
  return { x: Math.round(pt.x/GRID)*GRID, y: Math.round(pt.y/GRID)*GRID };
}
function getWorld(e, doSnap=true) {
  const r = mainCanvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (mainCanvas.width/r.width);
  const sy = (e.clientY - r.top) * (mainCanvas.height/r.height);
  const w = screenToWorld(sx, sy);
  return doSnap ? snap(w) : w;
}

// ─── HISTORY ───
function saveHistory() {
  if (histIdx < history.length-1) history = history.slice(0, histIdx+1);
  history.push(JSON.parse(JSON.stringify(elements)));
  if (history.length > MAX_HIST) history.shift();
  histIdx = history.length-1;
  updateUI();
}
function undo() {
  if (histIdx > 0) { histIdx--; elements = JSON.parse(JSON.stringify(history[histIdx])); deselect(); render(); updateUI(); }
}
function redo() {
  if (histIdx < history.length-1) { histIdx++; elements = JSON.parse(JSON.stringify(history[histIdx])); deselect(); render(); updateUI(); }
}
function deselect() {
  selectedEl = null; selectedIdx = -1;
  document.getElementById('editSection').style.display = 'none';
  updateInspector(null);
}

// ─── DRAW UTILS ───
function applyStyle(el, zoomOverride) {
  const z = zoomOverride || camera.zoom;
  ctx.strokeStyle = el.color || '#fff';
  ctx.fillStyle = el.color || '#fff';
  ctx.lineWidth = 2/z;
  ctx.setLineDash([]);
  if (el.lineStyle === 'dashed') { ctx.lineWidth = 2/z; ctx.setLineDash([12/z, 7/z]); }
  else if (el.lineStyle === 'dotted') { ctx.lineWidth = 2/z; ctx.setLineDash([2/z, 7/z]); }
  else if (el.lineStyle === 'bold') ctx.lineWidth = 5/z;
  else if (el.lineStyle === 'double') ctx.lineWidth = 1.5/z;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawArrowHead(fromX, fromY, toX, toY, size) {
  const angle = Math.atan2(toY-fromY, toX-fromX);
  const len = size || 14/camera.zoom;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - len*Math.cos(angle-0.45), toY - len*Math.sin(angle-0.45));
  ctx.lineTo(toX - len*Math.cos(angle+0.45), toY - len*Math.sin(angle+0.45));
  ctx.closePath();
  ctx.fill();
}

function drawElement(el, isTemp) {
  ctx.save();
  applyStyle(el);
  const alpha = isTemp ? 0.6 : 1;
  ctx.globalAlpha = alpha;

  if (selectedEl === el && !isTemp) {
    ctx.shadowColor = '#4f8ef7';
    ctx.shadowBlur = 18/camera.zoom;
  }

  switch(el.type) {
    case 'line': {
      const p1 = worldToScreen(el.x1,el.y1), p2 = worldToScreen(el.x2,el.y2);
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
      break;
    }
    case 'rect': {
      const tl = worldToScreen(el.x,el.y), br = worldToScreen(el.x+el.w,el.y+el.h);
      ctx.beginPath(); ctx.rect(tl.x,tl.y,br.x-tl.x,br.y-tl.y); ctx.stroke();
      break;
    }
    case 'ellipse': {
      const center = worldToScreen(el.cx,el.cy);
      const rx = el.rx*camera.zoom, ry = el.ry*camera.zoom;
      ctx.beginPath(); ctx.ellipse(center.x,center.y,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2); ctx.stroke();
      break;
    }
    case 'arc': {
      const a1=worldToScreen(el.p1.x,el.p1.y), a2=worldToScreen(el.p2.x,el.p2.y), a3=worldToScreen(el.p3.x,el.p3.y);
      ctx.beginPath(); ctx.moveTo(a1.x,a1.y); ctx.quadraticCurveTo(a2.x,a2.y,a3.x,a3.y); ctx.stroke();
      break;
    }
    case 'text': {
      const tp = worldToScreen(el.x,el.y);
      ctx.font = `${el.italic?'italic ':''} ${18/camera.zoom}px 'DM Sans', sans-serif`;
      ctx.fillStyle = el.color;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillText(el.text, tp.x, tp.y);
      if (selectedEl === el) {
        const w = ctx.measureText(el.text).width;
        ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 1/camera.zoom;
        ctx.setLineDash([4/camera.zoom,4/camera.zoom]);
        ctx.strokeRect(tp.x-2/camera.zoom, tp.y-16/camera.zoom, w+4/camera.zoom, 22/camera.zoom);
        ctx.setLineDash([]);
      }
      break;
    }
    case 'arrow': {
      if (el.points.length < 2) break;
      ctx.setLineDash([]);
      if (el.lineStyle === 'dashed') ctx.setLineDash([12/camera.zoom, 7/camera.zoom]);
      if (el.lineStyle === 'dotted') ctx.setLineDash([2/camera.zoom, 7/camera.zoom]);

      // Draw path
      ctx.beginPath();
      const sp = worldToScreen(el.points[0].x, el.points[0].y);
      ctx.moveTo(sp.x, sp.y);

      for (let i = 1; i < el.points.length; i++) {
        if (el.arrowStyle === 'route' && i < el.points.length-1) {
          const pp = worldToScreen(el.points[i].x, el.points[i].y);
          ctx.lineTo(pp.x, pp.y);
        } else {
          const pp = worldToScreen(el.points[i].x, el.points[i].y);
          ctx.lineTo(pp.x, pp.y);
        }
      }
      ctx.stroke();

      // Draw intermediate route dots
      if (el.arrowStyle === 'route') {
        for (let i = 1; i < el.points.length-1; i++) {
          const pp = worldToScreen(el.points[i].x, el.points[i].y);
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 4/camera.zoom, 0, Math.PI*2);
          ctx.fillStyle = el.color;
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
          ctx.fill();
        }
      }

      // Arrow head(s)
      const n = el.points.length;
      const last = worldToScreen(el.points[n-1].x, el.points[n-1].y);
      const prev = worldToScreen(el.points[n-2].x, el.points[n-2].y);
      ctx.fillStyle = el.color;
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      drawArrowHead(prev.x, prev.y, last.x, last.y);

      if (el.arrowStyle === 'arrow2') {
        const first = worldToScreen(el.points[0].x, el.points[0].y);
        const second = worldToScreen(el.points[1].x, el.points[1].y);
        drawArrowHead(second.x, second.y, first.x, first.y);
      }

      // Start dot
      const fp = worldToScreen(el.points[0].x, el.points[0].y);
      ctx.beginPath(); ctx.arc(fp.x,fp.y,3/camera.zoom,0,Math.PI*2);
      ctx.fillStyle = el.color; ctx.fill();

      break;
    }
    case 'zone': {
      if (!el.points || el.points.length < 2) break;
      const pts = el.points.map(p => worldToScreen(p.x,p.y));
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(el.color, el.opacity||0.2);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  // Label
  if (el.label && el.type !== 'text') {
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    let lx, ly;
    switch(el.type) {
      case 'line': { const mid = worldToScreen((el.x1+el.x2)/2,(el.y1+el.y2)/2); lx=mid.x; ly=mid.y-6/camera.zoom; break; }
      case 'rect': { const c=worldToScreen(el.x+el.w/2,el.y+el.h/2); lx=c.x; ly=c.y; break; }
      case 'ellipse': { const c=worldToScreen(el.cx,el.cy); lx=c.x; ly=c.y; break; }
      case 'arrow': {
        const mid = Math.floor(el.points.length/2);
        const m=worldToScreen(el.points[mid].x,el.points[mid].y); lx=m.x+5/camera.zoom; ly=m.y-8/camera.zoom; break;
      }
      default: { lx=0; ly=0; }
    }
    ctx.font = `${12/camera.zoom}px 'DM Sans', sans-serif`;
    ctx.fillStyle = el.color;
    ctx.globalAlpha = 0.85;
    ctx.fillText(el.label, lx, ly);
  }

  // Double line
  if (el.lineStyle === 'double' && (el.type==='line'||el.type==='rect'||el.type==='ellipse')) {
    const off = 4/camera.zoom;
    ctx.translate(off, off);
    ctx.beginPath();
    if (el.type==='line') {
      const p1=worldToScreen(el.x1,el.y1),p2=worldToScreen(el.x2,el.y2);
      ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── HIT TEST ───
function hitTest(wx, wy, el) {
  const tol = 10/camera.zoom;
  switch(el.type) {
    case 'line': return ptToSegDist(wx,wy,el.x1,el.y1,el.x2,el.y2) < tol;
    case 'rect': return wx>=el.x-tol && wx<=el.x+el.w+tol && wy>=el.y-tol && wy<=el.y+el.h+tol;
    case 'ellipse': return Math.abs((wx-el.cx)**2/((el.rx||1)**2) + (wy-el.cy)**2/((el.ry||1)**2) - 1) < 0.5;
    case 'arc': {
      const xs=[el.p1.x,el.p2.x,el.p3.x], ys=[el.p1.y,el.p2.y,el.p3.y];
      return wx>=Math.min(...xs)-tol&&wx<=Math.max(...xs)+tol&&wy>=Math.min(...ys)-tol&&wy<=Math.max(...ys)+tol;
    }
    case 'text': return wx>=el.x-tol&&wx<=el.x+el.text.length*10+tol&&wy>=el.y-20&&wy<=el.y+5;
    case 'arrow': {
      for (let i=0;i<el.points.length-1;i++) {
        if (ptToSegDist(wx,wy,el.points[i].x,el.points[i].y,el.points[i+1].x,el.points[i+1].y) < tol) return true;
      }
      return false;
    }
    case 'zone': {
      if (!el.points||el.points.length<3) return false;
      return pointInPolygon(wx,wy,el.points);
    }
  }
  return false;
}

function ptToSegDist(px,py,x1,y1,x2,y2) {
  const A=px-x1,B=py-y1,C=x2-x1,D=y2-y1;
  const dot=A*C+B*D, len=C*C+D*D;
  const t=len===0?0:Math.max(0,Math.min(1,dot/len));
  return Math.hypot(px-(x1+t*C), py-(y1+t*D));
}

function pointInPolygon(px,py,pts) {
  let inside=false;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
    if ((pts[i].y>py)!==(pts[j].y>py) && px<(pts[j].x-pts[i].x)*(py-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x) inside=!inside;
  }
  return inside;
}

// ─── GRID & RENDER ───
function drawGrid() {
  if (!showGrid) return;
  const lw = screenToWorld(0,0), rb = screenToWorld(mainCanvas.width, mainCanvas.height);
  const sx = Math.floor(lw.x/GRID)*GRID;
  const sy = Math.floor(lw.y/GRID)*GRID;
  const ex = Math.ceil(rb.x/GRID)*GRID;
  const ey = Math.ceil(rb.y/GRID)*GRID;

  const style = getComputedStyle(document.body);
  const minor = style.getPropertyValue('--grid-minor').trim();
  const major = style.getPropertyValue('--grid-major').trim();
  const canvasBg = style.getPropertyValue('--canvas-bg').trim();

  ctx.fillStyle = canvasBg;
  ctx.fillRect(0,0,mainCanvas.width,mainCanvas.height);

  for (let x=sx;x<=ex;x+=GRID) {
    const s=worldToScreen(x,0);
    const isMaj = x%(GRID*5)===0;
    ctx.beginPath(); ctx.moveTo(s.x,0); ctx.lineTo(s.x,mainCanvas.height);
    ctx.strokeStyle = isMaj?major:minor;
    ctx.lineWidth = isMaj?1:0.5;
    ctx.stroke();
  }
  for (let y=sy;y<=ey;y+=GRID) {
    const s=worldToScreen(0,y);
    const isMaj = y%(GRID*5)===0;
    ctx.beginPath(); ctx.moveTo(0,s.y); ctx.lineTo(mainCanvas.width,s.y);
    ctx.strokeStyle = isMaj?major:minor;
    ctx.lineWidth = isMaj?1:0.5;
    ctx.stroke();
  }

  // Origin cross
  const orig = worldToScreen(0,0);
  const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(orig.x-15,orig.y); ctx.lineTo(orig.x+15,orig.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(orig.x,orig.y-15); ctx.lineTo(orig.x,orig.y+15); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function drawTempArcPreview() {
  if (arcPts.length===0) return;
  ctx.save();
  ctx.strokeStyle = currentColor; ctx.globalAlpha=0.5; ctx.lineWidth=2/camera.zoom; ctx.setLineDash([6/camera.zoom,4/camera.zoom]);
  ctx.beginPath();
  const p0=worldToScreen(arcPts[0].x,arcPts[0].y);
  ctx.moveTo(p0.x,p0.y);
  for (let i=1;i<arcPts.length;i++) {
    const p=worldToScreen(arcPts[i].x,arcPts[i].y); ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();
  arcPts.forEach(p => {
    const s=worldToScreen(p.x,p.y);
    ctx.beginPath(); ctx.arc(s.x,s.y,4/camera.zoom,0,Math.PI*2);
    ctx.fillStyle=currentColor; ctx.globalAlpha=0.8; ctx.fill();
  });
  ctx.restore();
}

function drawTempArrowPreview() {
  if (arrowPts.length===0) return;
  ctx.save();
  ctx.strokeStyle = currentColor; ctx.globalAlpha=0.5; ctx.lineWidth=2/camera.zoom; ctx.setLineDash([6/camera.zoom,4/camera.zoom]);
  const p0=worldToScreen(arrowPts[0].x,arrowPts[0].y);
  ctx.beginPath(); ctx.moveTo(p0.x,p0.y);
  for (let i=1;i<arrowPts.length;i++) {
    const p=worldToScreen(arrowPts[i].x,arrowPts[i].y); ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();
  // dots
  arrowPts.forEach((pt,i) => {
    const s=worldToScreen(pt.x,pt.y);
    ctx.beginPath(); ctx.arc(s.x,s.y,i===0?4/camera.zoom:3/camera.zoom,0,Math.PI*2);
    ctx.fillStyle=currentColor; ctx.globalAlpha=0.9; ctx.setLineDash([]); ctx.fill();
  });
  ctx.restore();
}

function render() {
  ctx.clearRect(0,0,mainCanvas.width,mainCanvas.height);
  drawGrid();

  elements.forEach(el => drawElement(el, false));
  if (tempEl) drawElement(tempEl, true);
  drawTempArcPreview();
  drawTempArrowPreview();

  // selection handles
  if (selectedEl) drawHandles(selectedEl);

  renderMinimap();
}

function drawHandles(el) {
  const pts = getBoundingPts(el);
  if (!pts) return;
  ctx.save();
  ctx.strokeStyle='#4f8ef7'; ctx.fillStyle='#fff';
  ctx.lineWidth=1.5/camera.zoom;
  pts.forEach(p => {
    const s=worldToScreen(p.x,p.y);
    ctx.beginPath(); ctx.rect(s.x-4/camera.zoom,s.y-4/camera.zoom,8/camera.zoom,8/camera.zoom);
    ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

function getBoundingPts(el) {
  switch(el.type) {
    case 'line': return [{x:el.x1,y:el.y1},{x:el.x2,y:el.y2}];
    case 'rect': return [{x:el.x,y:el.y},{x:el.x+el.w,y:el.y},{x:el.x+el.w,y:el.y+el.h},{x:el.x,y:el.y+el.h}];
    case 'ellipse': return [{x:el.cx-el.rx,y:el.cy},{x:el.cx+el.rx,y:el.cy},{x:el.cx,y:el.cy-el.ry},{x:el.cx,y:el.cy+el.ry}];
    case 'arc': return [el.p1,el.p2,el.p3];
    case 'arrow': return el.points;
    case 'zone': return el.points;
    default: return null;
  }
}

// ─── MINIMAP ───
function renderMinimap() {
  mmCtx.clearRect(0,0,140,90);
  const style = getComputedStyle(document.body);
  mmCtx.fillStyle = style.getPropertyValue('--bg3').trim()||'#1e2330';
  mmCtx.fillRect(0,0,140,90);

  if (elements.length===0) return;

  // find bounds
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  elements.forEach(el => {
    const pts = getElPoints(el);
    pts.forEach(p => { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); });
  });
  const pad=60;
  minX-=pad;maxX+=pad;minY-=pad;maxY+=pad;
  const wW=maxX-minX||1, wH=maxY-minY||1;
  const sx=140/wW, sy=90/wH, sc=Math.min(sx,sy)*0.85;
  const ox=70-(minX+wW/2)*sc, oy=45-(minY+wH/2)*sc;

  elements.forEach(el => {
    mmCtx.strokeStyle=el.color||'#4f8ef7';
    mmCtx.lineWidth=1;
    mmCtx.globalAlpha=0.7;
    const pts=getElPoints(el);
    if (pts.length<2) return;
    mmCtx.beginPath();
    mmCtx.moveTo(pts[0].x*sc+ox, pts[0].y*sc+oy);
    for (let i=1;i<pts.length;i++) mmCtx.lineTo(pts[i].x*sc+ox, pts[i].y*sc+oy);
    mmCtx.stroke();
  });

  // viewport rect
  const tl=screenToWorld(0,0), br=screenToWorld(mainCanvas.width,mainCanvas.height);
  mmCtx.globalAlpha=0.5;
  mmCtx.strokeStyle='#4f8ef7';
  mmCtx.lineWidth=1.5;
  mmCtx.strokeRect(tl.x*sc+ox, tl.y*sc+oy, (br.x-tl.x)*sc, (br.y-tl.y)*sc);
  mmCtx.globalAlpha=1;
}

function getElPoints(el) {
  switch(el.type) {
    case 'line': return [{x:el.x1,y:el.y1},{x:el.x2,y:el.y2}];
    case 'rect': return [{x:el.x,y:el.y},{x:el.x+el.w,y:el.y+el.h}];
    case 'ellipse': return [{x:el.cx-el.rx,y:el.cy-el.ry},{x:el.cx+el.rx,y:el.cy+el.ry}];
    case 'arc': return [el.p1,el.p2,el.p3];
    case 'text': return [{x:el.x,y:el.y}];
    case 'arrow': return el.points;
    case 'zone': return el.points||[];
    default: return [];
  }
}

// ─── UI UPDATES ───
function updateUI() {
  document.getElementById('elCount').textContent = elements.length;
  document.getElementById('sbCount').textContent = elements.length;
  document.getElementById('sbZoom').textContent = Math.round(camera.zoom*100)+'%';
  document.getElementById('zoomLabel').textContent = Math.round(camera.zoom*100)+'%';
  document.getElementById('sbSnap').textContent = 'Сетка: '+(snapEnabled?'вкл':'выкл');
  updateElList();
}

function updateElList() {
  const list = document.getElementById('elList');
  list.innerHTML='';
  elements.forEach((el,i) => {
    const div=document.createElement('div');
    div.className='el-item'+(selectedEl===el?' selected':'');
    div.innerHTML=`<div class="el-dot" style="background:${el.color||'#888'}"></div>
      <span class="el-name">${el.label||elTypeName(el.type)} ${i+1}</span>
      <span class="el-del" data-idx="${i}">✕</span>`;
    div.querySelector('.el-name').addEventListener('click', ()=>selectEl(i));
    div.querySelector('.el-del').addEventListener('click', e=>{ e.stopPropagation(); deleteEl(i); });
    list.appendChild(div);
  });
}

function elTypeName(t) {
  return {select:'Объект',line:'Линия',rect:'Прямоуг.',ellipse:'Эллипс',arc:'Дуга',text:'Текст',arrow:'Стрелка',zone:'Зона'}[t]||t;
}

function selectEl(i) {
  selectedEl = elements[i];
  selectedIdx = i;
  showEditPanel(elements[i]);
  updateElList();
  updateInspector(elements[i]);
  render();
}

function deleteEl(i) {
  elements.splice(i,1);
  if (selectedIdx===i) deselect();
  else if (selectedIdx>i) selectedIdx--;
  saveHistory(); render(); updateUI();
}

function showEditPanel(el) {
  const sec = document.getElementById('editSection');
  sec.style.display='block';
  document.getElementById('editColor').value = el.color||'#4f8ef7';
  document.getElementById('editStyle').value = el.lineStyle||'solid';
  document.getElementById('editArrowRow').style.display = el.type==='arrow'?'flex':'none';
  if (el.type==='arrow') document.getElementById('editArrowStyle').value = el.arrowStyle||'arrow';
  document.getElementById('editTextRow').style.display = el.type==='text'?'flex':'none';
  if (el.type==='text') document.getElementById('editText').value = el.text||'';
  document.getElementById('editZoneRow').style.display = el.type==='zone'?'flex':'none';
  if (el.type==='zone') document.getElementById('editOpacity').value = Math.round((el.opacity||0.2)*100);
  document.getElementById('editLabel').value = el.label||'';
}

function updateInspector(el) {
  if (!el) {
    ['inspX','inspY','inspW','inspH'].forEach(id=>document.getElementById(id).textContent='—');
    return;
  }
  const pts = getElPoints(el);
  if (pts.length===0) return;
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const minX=Math.min(...xs), minY=Math.min(...ys);
  const maxX=Math.max(...xs), maxY=Math.max(...ys);
  document.getElementById('inspX').textContent = Math.round(minX);
  document.getElementById('inspY').textContent = Math.round(minY);
  document.getElementById('inspW').textContent = Math.round(maxX-minX);
  document.getElementById('inspH').textContent = Math.round(maxY-minY);
}

function showHint(msg) {
  const h=document.getElementById('drawHint');
  h.textContent=msg; h.classList.add('visible');
}
function hideHint() {
  document.getElementById('drawHint').classList.remove('visible');
}

const TOOL_HINTS = {
  select: 'Кликните объект для выбора',
  line: 'Нажмите — начало, отпустите — конец',
  rect: 'Нажмите и тяните для прямоугольника',
  ellipse: 'Нажмите и тяните для эллипса',
  arc: 'Клик 1: начало · Клик 2: контроль · Клик 3: конец',
  text: 'Кликните место для текста',
  arrow: 'Кликайте точки маршрута · Двойной клик — завершить',
  zone: 'Кликайте вершины зоны · Двойной клик — завершить'
};

// ─── MOUSE EVENTS ───
mainCanvas.addEventListener('mousedown', e=>{
  e.preventDefault();
  const wPos = getWorld(e, snapEnabled);
  const wPosRaw = getWorld(e, false);

  // Middle or Ctrl+left = pan
  if (e.button===1 || (e.button===0 && e.altKey)) {
    isPanning=true; lastMouse={x:e.clientX,y:e.clientY};
    canvasWrap.style.cursor='grabbing'; return;
  }
  if (e.button!==0) return;

  if (currentTool==='select') {
    for (let i=elements.length-1;i>=0;i--) {
      if (hitTest(wPosRaw.x,wPosRaw.y,elements[i])) { selectEl(i); return; }
    }
    deselect(); render(); return;
  }

  if (currentTool==='text') {
    const t=prompt('Введите текст:','Метка');
    if (t) {
      elements.push({type:'text',text:t,x:wPos.x,y:wPos.y,color:currentColor,lineStyle:currentLineStyle});
      saveHistory(); render(); updateUI();
    }
    return;
  }

  if (currentTool==='arrow') {
    if (!drawing) { drawing=true; arrowPts=[{...wPos}]; }
    else { arrowPts.push({...wPos}); }
    render(); return;
  }

  if (currentTool==='zone') {
    if (!drawing) { drawing=true; arrowPts=[{...wPos}]; }
    else { arrowPts.push({...wPos}); }
    render(); return;
  }

  if (currentTool==='arc') {
    if (!drawing) { drawing=true; arcPts=[{...wPos}]; }
    else {
      arcPts.push({...wPos});
      if (arcPts.length===3) {
        elements.push({type:'arc',p1:{...arcPts[0]},p2:{...arcPts[1]},p3:{...arcPts[2]},color:currentColor,lineStyle:currentLineStyle});
        drawing=false; arcPts=[]; tempEl=null; saveHistory(); render(); updateUI();
      }
    }
    render(); return;
  }

  startPt = {...wPos};
  drawing = true;

  if (currentTool==='line') {
    tempEl={type:'line',x1:wPos.x,y1:wPos.y,x2:wPos.x,y2:wPos.y,color:currentColor,lineStyle:currentLineStyle};
  } else if (currentTool==='rect') {
    tempEl={type:'rect',x:wPos.x,y:wPos.y,w:0,h:0,color:currentColor,lineStyle:currentLineStyle};
  } else if (currentTool==='ellipse') {
    tempEl={type:'ellipse',cx:wPos.x,cy:wPos.y,rx:0,ry:0,color:currentColor,lineStyle:currentLineStyle};
  }
  render();
});

mainCanvas.addEventListener('mousemove', e=>{
  const wRaw = getWorld(e, false);
  mouseWorld = wRaw;
  document.getElementById('hudX').textContent = Math.round(wRaw.x);
  document.getElementById('hudY').textContent = Math.round(wRaw.y);

  if (isPanning) {
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    camera.x -= dx/camera.zoom; camera.y -= dy/camera.zoom;
    lastMouse={x:e.clientX,y:e.clientY};
    render(); return;
  }

  if (!drawing) return;
  const wPos = getWorld(e, snapEnabled);

  if (tempEl) {
    if (tempEl.type==='line') { tempEl.x2=wPos.x; tempEl.y2=wPos.y; }
    else if (tempEl.type==='rect') { tempEl.w=wPos.x-startPt.x; tempEl.h=wPos.y-startPt.y; }
    else if (tempEl.type==='ellipse') {
      tempEl.rx=Math.abs(wPos.x-startPt.x)/2;
      tempEl.ry=Math.abs(wPos.y-startPt.y)/2;
      tempEl.cx=startPt.x+(wPos.x-startPt.x)/2;
      tempEl.cy=startPt.y+(wPos.y-startPt.y)/2;
    }
  }
  render();
});

mainCanvas.addEventListener('mouseup', e=>{
  if (isPanning) { isPanning=false; canvasWrap.style.cursor='crosshair'; return; }
  if (!drawing) return;
  if (currentTool==='arrow'||currentTool==='zone'||currentTool==='arc') return;

  if (tempEl) {
    let valid=false;
    if (tempEl.type==='line') valid=Math.hypot(tempEl.x2-tempEl.x1,tempEl.y2-tempEl.y1)>3;
    else if (tempEl.type==='rect') valid=Math.abs(tempEl.w)>3&&Math.abs(tempEl.h)>3;
    else if (tempEl.type==='ellipse') valid=tempEl.rx>2&&tempEl.ry>2;
    if (valid) { elements.push({...tempEl}); saveHistory(); updateUI(); }
  }
  drawing=false; tempEl=null; render();
});

mainCanvas.addEventListener('dblclick', e=>{
  if (currentTool==='arrow' && drawing && arrowPts.length>=2) {
    elements.push({type:'arrow',points:[...arrowPts],color:currentColor,lineStyle:currentLineStyle,arrowStyle:currentArrowStyle});
    drawing=false; arrowPts=[]; saveHistory(); render(); updateUI();
  }
  if (currentTool==='zone' && drawing && arrowPts.length>=3) {
    elements.push({type:'zone',points:[...arrowPts],color:currentColor,lineStyle:currentLineStyle,opacity:0.2});
    drawing=false; arrowPts=[]; saveHistory(); render(); updateUI();
  }
});

mainCanvas.addEventListener('wheel', e=>{
  e.preventDefault();
  const r=mainCanvas.getBoundingClientRect();
  const mx=(e.clientX-r.left)*(mainCanvas.width/r.width);
  const my=(e.clientY-r.top)*(mainCanvas.height/r.height);
  const before=screenToWorld(mx,my);
  const factor = e.deltaY<0?1.1:0.9;
  camera.zoom=Math.min(camera.maxZoom,Math.max(camera.minZoom,camera.zoom*factor));
  const after=screenToWorld(mx,my);
  camera.x+=before.x-after.x; camera.y+=before.y-after.y;
  document.getElementById('zoomLabel').textContent=Math.round(camera.zoom*100)+'%';
  document.getElementById('sbZoom').textContent=Math.round(camera.zoom*100)+'%';
  render();
},{passive:false});

// ─── TOOLBAR LISTENERS ───
document.querySelectorAll('[data-tool]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-tool]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentTool=btn.dataset.tool;
    drawing=false; tempEl=null; arcPts=[]; arrowPts=[];
    // show/hide arrow style select
    document.getElementById('arrowStyleSelect').style.display = currentTool==='arrow'?'':'none';
    showHint(TOOL_HINTS[currentTool]||'');
    setTimeout(hideHint,3000);
    render();
  });
});

document.getElementById('colorInput').addEventListener('input',e=>{
  currentColor=e.target.value;
  document.getElementById('colorHex').textContent=e.target.value;
});

document.getElementById('lineStyleSelect').addEventListener('change',e=>currentLineStyle=e.target.value);
document.getElementById('arrowStyleSelect').addEventListener('change',e=>currentArrowStyle=e.target.value);

// Quick colors
document.querySelectorAll('.quick-color').forEach(el=>{
  el.addEventListener('click',()=>{
    currentColor=el.dataset.c;
    document.getElementById('colorInput').value=currentColor;
    document.getElementById('colorHex').textContent=currentColor;
  });
});

// Snap toggle
const snapToggleEl = document.getElementById('snapToggle');
document.getElementById('snapCheck').addEventListener('change',e=>{
  snapEnabled=e.target.checked;
  snapToggleEl.classList.toggle('on',snapEnabled);
  document.getElementById('sbSnap').textContent='Сетка: '+(snapEnabled?'вкл':'выкл');
});
snapToggleEl.addEventListener('click',()=>{
  const cb=document.getElementById('snapCheck');
  cb.checked=!cb.checked; cb.dispatchEvent(new Event('change'));
});

// Undo/Redo
document.getElementById('undoBtn').addEventListener('click',undo);
document.getElementById('redoBtn').addEventListener('click',redo);

// Zoom
document.getElementById('zoomInBtn').addEventListener('click',()=>{
  camera.zoom=Math.min(camera.maxZoom,camera.zoom*1.2);
  document.getElementById('zoomLabel').textContent=Math.round(camera.zoom*100)+'%';
  document.getElementById('sbZoom').textContent=Math.round(camera.zoom*100)+'%';
  render();
});
document.getElementById('zoomOutBtn').addEventListener('click',()=>{
  camera.zoom=Math.max(camera.minZoom,camera.zoom/1.2);
  document.getElementById('zoomLabel').textContent=Math.round(camera.zoom*100)+'%';
  document.getElementById('sbZoom').textContent=Math.round(camera.zoom*100)+'%';
  render();
});
document.getElementById('resetViewBtn').addEventListener('click',()=>{
  camera.x=0;camera.y=0;camera.zoom=1;
  document.getElementById('zoomLabel').textContent='100%';
  document.getElementById('sbZoom').textContent='100%';
  render();
});

// Theme
document.getElementById('themeBtn').addEventListener('click',()=>{
  theme = theme==='dark'?'light':'dark';
  document.body.className = theme==='dark'?'theme-dark':'light';
  render();
});

// Grid visibility
document.getElementById('gridVisBtn').addEventListener('click',()=>{
  showGrid=!showGrid; render();
});

// Save screenshot
document.getElementById('saveScreenBtn').addEventListener('click',()=>{
  const tmp=document.createElement('canvas');
  tmp.width=mainCanvas.width; tmp.height=mainCanvas.height;
  const tc=tmp.getContext('2d');
  tc.fillStyle=getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim();
  tc.fillRect(0,0,tmp.width,tmp.height);
  tc.drawImage(mainCanvas,0,0);
  const a=document.createElement('a');
  a.download=`draftcraft-${Date.now()}.png`;
  a.href=tmp.toDataURL('image/png');
  a.click();
});

// Save project
document.getElementById('saveFileBtn').addEventListener('click',()=>{
  const data=JSON.stringify({version:'3.0',elements},null,2);
  const b=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.download=`project-${Date.now()}.draft`;
  a.href=url; a.click();
  URL.revokeObjectURL(url);
});

// Open file
document.getElementById('openFileInput').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try {
      const p=JSON.parse(ev.target.result);
      if (p.elements) { elements=p.elements; deselect(); saveHistory(); render(); updateUI(); }
      else alert('Неверный формат файла');
    } catch { alert('Ошибка чтения файла'); }
  };
  r.readAsText(f); e.target.value='';
});

// Clear
document.getElementById('clearBtn').addEventListener('click',()=>{
  if (confirm('Очистить весь чертёж?')) {
    elements=[]; deselect(); saveHistory(); render(); updateUI();
  }
});

// Edit panel apply
document.getElementById('applyEditBtn').addEventListener('click',()=>{
  if (!selectedEl) return;
  selectedEl.color=document.getElementById('editColor').value;
  selectedEl.lineStyle=document.getElementById('editStyle').value;
  if (selectedEl.type==='arrow') selectedEl.arrowStyle=document.getElementById('editArrowStyle').value;
  if (selectedEl.type==='text') { const t=document.getElementById('editText').value; if(t) selectedEl.text=t; }
  if (selectedEl.type==='zone') selectedEl.opacity=parseInt(document.getElementById('editOpacity').value)/100;
  const lbl=document.getElementById('editLabel').value;
  if (lbl) selectedEl.label=lbl; else delete selectedEl.label;
  saveHistory(); render(); updateUI(); updateInspector(selectedEl);
});

// Delete selected
document.getElementById('deleteBtn').addEventListener('click',()=>{
  if (selectedIdx>=0) deleteEl(selectedIdx);
});

// Keyboard
document.addEventListener('keydown',e=>{
  if (e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return;
  if (e.ctrlKey||e.metaKey) {
    if (e.key==='z') { e.preventDefault(); undo(); }
    else if (e.key==='y') { e.preventDefault(); redo(); }
    else if (e.key==='='||e.key==='+') { e.preventDefault(); document.getElementById('zoomInBtn').click(); }
    else if (e.key==='-') { e.preventDefault(); document.getElementById('zoomOutBtn').click(); }
    return;
  }
  switch(e.key) {
    case 'Escape':
      drawing=false; tempEl=null; arcPts=[]; arrowPts=[]; deselect(); render(); hideHint(); break;
    case 'Delete': case 'Backspace':
      if (selectedIdx>=0) deleteEl(selectedIdx); break;
    case 'v': case 'V': document.querySelector('[data-tool="select"]').click(); break;
    case 'l': case 'L': document.querySelector('[data-tool="line"]').click(); break;
    case 'r': case 'R': document.querySelector('[data-tool="rect"]').click(); break;
    case 'e': case 'E': document.querySelector('[data-tool="ellipse"]').click(); break;
    case 'a': case 'A': document.querySelector('[data-tool="arc"]').click(); break;
    case 'w': case 'W': document.querySelector('[data-tool="arrow"]').click(); break;
    case 't': case 'T': document.querySelector('[data-tool="text"]').click(); break;
    case 'z': case 'Z': document.querySelector('[data-tool="zone"]').click(); break;
    case '0': document.getElementById('resetViewBtn').click(); break;
  }
});

// ─── INIT DEMO ───
function initDemo() {
  elements = [
    {type:'zone',points:[{x:-270,y:-180},{x:90,y:-180},{x:90,y:90},{x:-270,y:90}],color:'#4ec994',lineStyle:'solid',opacity:0.1,label:'Зона A'},
    {type:'rect',x:-240,y:-150,w:120,h:90,color:'#4f8ef7',lineStyle:'solid',label:'Комната 1'},
    {type:'rect',x:-60,y:-150,w:120,h:90,color:'#4f8ef7',lineStyle:'solid',label:'Комната 2'},
    {type:'rect',x:-150,y:0,w:90,h:60,color:'#7b6af0',lineStyle:'dashed',label:'Лут'},
    {type:'line',x1:-180,y1:-60,x2:-60,y2:-60,color:'#b0b0c0',lineStyle:'solid'},
    {type:'line',x1:-60,y1:-60,x2:-60,y2:0,color:'#b0b0c0',lineStyle:'solid'},
    {type:'arrow',points:[{x:-180,y:-105},{x:-60,y:-105},{x:0,y:-60}],color:'#f0a946',lineStyle:'solid',arrowStyle:'route',label:'Маршрут игрока'},
    {type:'arrow',points:[{x:0,y:60},{x:90,y:60}],color:'#e05c5c',lineStyle:'dashed',arrowStyle:'arrow',label:'Выход'},
    {type:'text',text:'Старт',x:-195,y:-165,color:'#4ec994',lineStyle:'solid'},
    {type:'text',text:'Финал',x:60,y:60,color:'#e05c5c',lineStyle:'solid'},
    {type:'ellipse',cx:-150,cy:30,rx:20,ry:20,color:'#f0a946',lineStyle:'solid',label:'Босс'},
  ];
  saveHistory();
  render();
  updateUI();
}

initDemo();

})();
