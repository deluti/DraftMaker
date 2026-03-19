(function() {
    // ----- Элементы DOM -----
    const canvas = document.getElementById('gridCanvas');
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('canvasWrapper');
    const body = document.body;

    // ----- Параметры сетки -----
    const GRID_SIZE = 30;
    
    // Состояние камеры
    let camera = {
        x: 0,
        y: 0,
        zoom: 1.0,
        minZoom: 0.2,
        maxZoom: 3.0
    };

    // Состояние перетаскивания
    let isDraggingCamera = false;
    let lastMousePos = { x: 0, y: 0 };

    // ----- Состояние приложения -----
    let currentTool = 'select';
    let currentColor = '#1e3a8a';
    let currentLineStyle = 'solid';

    // Массив объектов
    let elements = [];

    // История
    let history = [];
    let historyIndex = -1;
    const MAX_HISTORY = 50;

    // Выделенный объект
    let selectedElement = null;
    let selectedElementIndex = -1;

    // Состояние рисования
    let drawingInProgress = false;
    let tempElement = null;
    let startPoint = { x: 0, y: 0 };
    let arcPoints = [];
    let vectorPoints = [];

    // Текущая тема
    let currentTheme = 'dark';

    // ----- Переключение темы -----
    function toggleTheme() {
        if (currentTheme === 'dark') {
            body.classList.remove('theme-dark');
            body.classList.add('theme-light');
            currentTheme = 'light';
        } else {
            body.classList.remove('theme-light');
            body.classList.add('theme-dark');
            currentTheme = 'dark';
        }
        render(); // Перерисовываем для обновления цветов сетки
    }

    // ----- Инициализация -----
    function initDemo() {
        elements.push({
            type: 'line',
            x1: 100, y1: 100,
            x2: 300, y2: 200,
            color: '#1e3a8a',
            style: 'solid'
        });
        elements.push({
            type: 'rect',
            x: 400, y: 150,
            w: 200, h: 120,
            color: '#b91c1c',
            style: 'dashed'
        });
        elements.push({
            type: 'text',
            text: 'Старт',
            x: 500, y: 300,
            color: '#047857',
            style: 'italic'
        });
        saveHistory();
        render();
    }

    // ----- История -----
    function saveHistory() {
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        
        history.push(JSON.parse(JSON.stringify(elements)));
        
        if (history.length > MAX_HISTORY) {
            history.shift();
        }
        
        historyIndex = history.length - 1;
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            elements = JSON.parse(JSON.stringify(history[historyIndex]));
            selectedElement = null;
            selectedElementIndex = -1;
            hideEditPanel();
            render();
        }
    }

    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            elements = JSON.parse(JSON.stringify(history[historyIndex]));
            selectedElement = null;
            selectedElementIndex = -1;
            hideEditPanel();
            render();
        }
    }

    // ----- Преобразование координат -----
    function screenToWorld(screenX, screenY) {
        return {
            x: (screenX - canvas.width / 2) / camera.zoom + camera.x,
            y: (screenY - canvas.height / 2) / camera.zoom + camera.y
        };
    }

    function worldToScreen(worldX, worldY) {
        return {
            x: (worldX - camera.x) * camera.zoom + canvas.width / 2,
            y: (worldY - camera.y) * camera.zoom + canvas.height / 2
        };
    }

    function snapToGrid(worldX, worldY) {
        return {
            x: Math.round(worldX / GRID_SIZE) * GRID_SIZE,
            y: Math.round(worldY / GRID_SIZE) * GRID_SIZE
        };
    }

    function getMouseWorld(e, snap = true) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const screenX = (e.clientX - rect.left) * scaleX;
        const screenY = (e.clientY - rect.top) * scaleY;
        
        const world = screenToWorld(screenX, screenY);
        
        if (snap) {
            return snapToGrid(world.x, world.y);
        }
        return world;
    }

    // ----- Отрисовка -----
    function drawGrid() {
        const leftWorld = screenToWorld(0, 0).x;
        const rightWorld = screenToWorld(canvas.width, 0).x;
        const topWorld = screenToWorld(0, 0).y;
        const bottomWorld = screenToWorld(0, canvas.height).y;

        const startX = Math.floor(leftWorld / GRID_SIZE) * GRID_SIZE;
        const endX = Math.ceil(rightWorld / GRID_SIZE) * GRID_SIZE;
        const startY = Math.floor(topWorld / GRID_SIZE) * GRID_SIZE;
        const endY = Math.ceil(bottomWorld / GRID_SIZE) * GRID_SIZE;

        ctx.save();
        
        // Получаем цвета из CSS-переменных
        const gridColor = getComputedStyle(body).getPropertyValue('--grid-color').trim();
        const gridColorDark = getComputedStyle(body).getPropertyValue('--grid-color-dark').trim();
        
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.8 / camera.zoom;

        for (let x = startX; x <= endX; x += GRID_SIZE) {
            const screenPos = worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(screenPos.x, 0);
            ctx.lineTo(screenPos.x, canvas.height);
            ctx.strokeStyle = x % (GRID_SIZE * 5) === 0 ? gridColorDark : gridColor;
            ctx.stroke();
        }

        for (let y = startY; y <= endY; y += GRID_SIZE) {
            const screenPos = worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, screenPos.y);
            ctx.lineTo(canvas.width, screenPos.y);
            ctx.strokeStyle = y % (GRID_SIZE * 5) === 0 ? gridColorDark : gridColor;
            ctx.stroke();
        }

        // Рисуем центр координат
        const originScreen = worldToScreen(0, 0);
        ctx.beginPath();
        ctx.fillStyle = getComputedStyle(body).getPropertyValue('--accent-color').trim();
        ctx.arc(originScreen.x, originScreen.y, 4 / camera.zoom, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.restore();
    }

    function applyLineStyle(style, color = currentColor, zoom = camera.zoom) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.setLineDash([]);
        ctx.lineWidth = 2 / zoom;
        ctx.font = `${16 / zoom}px "Segoe UI", "Arial", sans-serif`;

        if (style === 'dashed') {
            ctx.setLineDash([12 / zoom, 8 / zoom]);
            ctx.lineWidth = 2.2 / zoom;
        } else if (style === 'bold') {
            ctx.setLineDash([]);
            ctx.lineWidth = 5 / zoom;
        } else if (style === 'italic') {
            ctx.setLineDash([]);
            ctx.lineWidth = 2.5 / zoom;
            ctx.font = `italic ${18 / zoom}px "Segoe UI", "Arial", sans-serif`;
        }
    }

    function hitTest(worldX, worldY, element) {
        const tolerance = 10 / camera.zoom;
        
        switch (element.type) {
            case 'line': {
                const x1 = element.x1, y1 = element.y1;
                const x2 = element.x2, y2 = element.y2;
                
                const A = worldX - x1;
                const B = worldY - y1;
                const C = x2 - x1;
                const D = y2 - y1;
                
                const dot = A * C + B * D;
                const len_sq = C * C + D * D;
                let param = len_sq === 0 ? 0 : dot / len_sq;
                
                let xx, yy;
                if (param < 0) {
                    xx = x1;
                    yy = y1;
                } else if (param > 1) {
                    xx = x2;
                    yy = y2;
                } else {
                    xx = x1 + param * C;
                    yy = y1 + param * D;
                }
                
                const dx = worldX - xx;
                const dy = worldY - yy;
                return Math.sqrt(dx*dx + dy*dy) < tolerance;
            }
            
            case 'rect': {
                return (worldX >= element.x - tolerance && 
                        worldX <= element.x + element.w + tolerance &&
                        worldY >= element.y - tolerance && 
                        worldY <= element.y + element.h + tolerance);
            }
            
            case 'arc': {
                const xs = [element.p1.x, element.p2.x, element.p3.x];
                const ys = [element.p1.y, element.p2.y, element.p3.y];
                const minX = Math.min(...xs) - tolerance;
                const maxX = Math.max(...xs) + tolerance;
                const minY = Math.min(...ys) - tolerance;
                const maxY = Math.max(...ys) + tolerance;
                return (worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY);
            }
            
            case 'text': {
                const width = element.text.length * 10;
                return (worldX >= element.x - tolerance && 
                        worldX <= element.x + width + tolerance &&
                        worldY >= element.y - 20 && 
                        worldY <= element.y + 5);
            }
            
            case 'vector': {
                for (let i = 0; i < element.points.length - 1; i++) {
                    const p1 = element.points[i];
                    const p2 = element.points[i+1];
                    
                    const A = worldX - p1.x;
                    const B = worldY - p1.y;
                    const C = p2.x - p1.x;
                    const D = p2.y - p1.y;
                    
                    const dot = A * C + B * D;
                    const len_sq = C * C + D * D;
                    let param = len_sq === 0 ? 0 : dot / len_sq;
                    
                    let xx, yy;
                    if (param < 0) {
                        xx = p1.x;
                        yy = p1.y;
                    } else if (param > 1) {
                        xx = p2.x;
                        yy = p2.y;
                    } else {
                        xx = p1.x + param * C;
                        yy = p1.y + param * D;
                    }
                    
                    const dx = worldX - xx;
                    const dy = worldY - yy;
                    if (Math.sqrt(dx*dx + dy*dy) < tolerance) return true;
                }
                return false;
            }
        }
        return false;
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid();

        elements.forEach((el, index) => {
            ctx.save();
            applyLineStyle(el.style, el.color, camera.zoom);
            
            if (selectedElement === el) {
                ctx.shadowColor = 'gold';
                ctx.shadowBlur = 15 / camera.zoom;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }

            switch (el.type) {
                case 'line':
                    ctx.beginPath();
                    const p1 = worldToScreen(el.x1, el.y1);
                    const p2 = worldToScreen(el.x2, el.y2);
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    break;
                    
                case 'rect':
                    ctx.beginPath();
                    const topLeft = worldToScreen(el.x, el.y);
                    const bottomRight = worldToScreen(el.x + el.w, el.y + el.h);
                    ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
                    ctx.stroke();
                    break;
                    
                case 'arc':
                    ctx.beginPath();
                    const a1 = worldToScreen(el.p1.x, el.p1.y);
                    const a2 = worldToScreen(el.p2.x, el.p2.y);
                    const a3 = worldToScreen(el.p3.x, el.p3.y);
                    ctx.moveTo(a1.x, a1.y);
                    ctx.quadraticCurveTo(a2.x, a2.y, a3.x, a3.y);
                    ctx.stroke();
                    break;
                    
                case 'text':
                    ctx.save();
                    ctx.font = el.style === 'italic' ? `italic ${20 / camera.zoom}px "Segoe UI"` : `${20 / camera.zoom}px "Segoe UI"`;
                    ctx.fillStyle = el.color;
                    const textPos = worldToScreen(el.x, el.y);
                    ctx.fillText(el.text, textPos.x, textPos.y);
                    ctx.restore();
                    break;
                    
                case 'vector':
                    if (el.points.length > 1) {
                        ctx.beginPath();
                        const first = worldToScreen(el.points[0].x, el.points[0].y);
                        ctx.moveTo(first.x, first.y);
                        for (let i = 1; i < el.points.length; i++) {
                            const pt = worldToScreen(el.points[i].x, el.points[i].y);
                            ctx.lineTo(pt.x, pt.y);
                        }
                        ctx.stroke();
                    }
                    break;
            }
            ctx.restore();
        });

        if (tempElement) {
            ctx.save();
            applyLineStyle(tempElement.style || currentLineStyle, tempElement.color || currentColor, camera.zoom);
            ctx.globalAlpha = 0.7;
            
            switch (tempElement.type) {
                case 'line':
                    if (tempElement.x1 !== undefined) {
                        const p1 = worldToScreen(tempElement.x1, tempElement.y1);
                        const p2 = worldToScreen(tempElement.x2, tempElement.y2);
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                    break;
                    
                case 'rect':
                    if (tempElement.x !== undefined) {
                        const tl = worldToScreen(tempElement.x, tempElement.y);
                        const br = worldToScreen(tempElement.x + tempElement.w, tempElement.y + tempElement.h);
                        ctx.beginPath();
                        ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
                        ctx.stroke();
                    }
                    break;
                    
                case 'arc':
                    if (tempElement.points) {
                        if (tempElement.points.length === 2) {
                            const p1 = worldToScreen(tempElement.points[0].x, tempElement.points[0].y);
                            const p2 = worldToScreen(tempElement.points[1].x, tempElement.points[1].y);
                            ctx.beginPath();
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.strokeStyle = '#aaa';
                            ctx.stroke();
                        } else if (tempElement.points.length === 3) {
                            const a1 = worldToScreen(tempElement.points[0].x, tempElement.points[0].y);
                            const a2 = worldToScreen(tempElement.points[1].x, tempElement.points[1].y);
                            const a3 = worldToScreen(tempElement.points[2].x, tempElement.points[2].y);
                            ctx.beginPath();
                            ctx.moveTo(a1.x, a1.y);
                            ctx.quadraticCurveTo(a2.x, a2.y, a3.x, a3.y);
                            ctx.stroke();
                        }
                    }
                    break;
                    
                case 'vector':
                    if (tempElement.points && tempElement.points.length > 0) {
                        ctx.beginPath();
                        const first = worldToScreen(tempElement.points[0].x, tempElement.points[0].y);
                        ctx.moveTo(first.x, first.y);
                        for (let i = 1; i < tempElement.points.length; i++) {
                            const pt = worldToScreen(tempElement.points[i].x, tempElement.points[i].y);
                            ctx.lineTo(pt.x, pt.y);
                        }
                        ctx.stroke();
                    }
                    break;
            }
            ctx.restore();
        }

        updateInspector();
    }

    // ----- UI Функции -----
    function showEditPanel(element) {
        const panel = document.getElementById('editPanel');
        const textRow = document.getElementById('editTextRow');
        const colorInput = document.getElementById('editColor');
        const styleSelect = document.getElementById('editStyle');
        const textInput = document.getElementById('editText');

        panel.style.display = 'block';
        colorInput.value = element.color || currentColor;
        styleSelect.value = element.style || 'solid';

        if (element.type === 'text') {
            textRow.style.display = 'flex';
            textInput.value = element.text || '';
        } else {
            textRow.style.display = 'none';
        }
    }

    function hideEditPanel() {
        document.getElementById('editPanel').style.display = 'none';
    }

    function updateInspector() {
        if (selectedElement) {
            document.getElementById('vecX').innerText = '—';
            document.getElementById('vecY').innerText = '—';
        } else if (elements.length > 0) {
            const lastEl = elements[elements.length - 1];
            if (lastEl.type === 'vector' && lastEl.points.length > 0) {
                const p = lastEl.points[lastEl.points.length - 1];
                document.getElementById('vecX').innerText = Math.round(p.x);
                document.getElementById('vecY').innerText = Math.round(p.y);
            } else {
                document.getElementById('vecX').innerText = '—';
                document.getElementById('vecY').innerText = '—';
            }
        } else {
            document.getElementById('vecX').innerText = '—';
            document.getElementById('vecY').innerText = '—';
        }
    }

    // ----- Обработчики мыши -----
    function handleMouseDown(e) {
        e.preventDefault();
        const worldPos = getMouseWorld(e, true);

        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
            isDraggingCamera = true;
            lastMousePos = { x: e.clientX, y: e.clientY };
            wrapper.style.cursor = 'grabbing';
            return;
        }

        if (currentTool === 'select') {
            for (let i = elements.length - 1; i >= 0; i--) {
                if (hitTest(worldPos.x, worldPos.y, elements[i])) {
                    selectedElement = elements[i];
                    selectedElementIndex = i;
                    showEditPanel(selectedElement);
                    render();
                    return;
                }
            }
            selectedElement = null;
            selectedElementIndex = -1;
            hideEditPanel();
            render();
            return;
        }

        if (currentTool === 'text') {
            const textStr = prompt('Введите текст:', 'комната');
            if (textStr) {
                elements.push({
                    type: 'text',
                    text: textStr,
                    x: worldPos.x,
                    y: worldPos.y,
                    color: currentColor,
                    style: currentLineStyle
                });
                saveHistory();
                render();
            }
            return;
        }

        if (currentTool === 'vector') {
            if (!drawingInProgress) {
                drawingInProgress = true;
                vectorPoints = [{ x: worldPos.x, y: worldPos.y }];
                tempElement = { type: 'vector', points: vectorPoints, color: currentColor, style: currentLineStyle };
            } else {
                vectorPoints.push({ x: worldPos.x, y: worldPos.y });
                tempElement.points = vectorPoints;
            }
            render();
            return;
        }

        if (currentTool === 'arc') {
            if (!drawingInProgress) {
                drawingInProgress = true;
                arcPoints = [{ x: worldPos.x, y: worldPos.y }];
                tempElement = { type: 'arc', points: arcPoints, color: currentColor, style: currentLineStyle };
            } else {
                arcPoints.push({ x: worldPos.x, y: worldPos.y });
                if (arcPoints.length === 3) {
                    elements.push({
                        type: 'arc',
                        p1: arcPoints[0],
                        p2: arcPoints[1],
                        p3: arcPoints[2],
                        color: currentColor,
                        style: currentLineStyle
                    });
                    drawingInProgress = false;
                    tempElement = null;
                    arcPoints = [];
                    saveHistory();
                } else {
                    tempElement.points = arcPoints;
                }
            }
            render();
            return;
        }

        startPoint = { x: worldPos.x, y: worldPos.y };
        drawingInProgress = true;
        if (currentTool === 'line') {
            tempElement = { type: 'line', x1: worldPos.x, y1: worldPos.y, x2: worldPos.x, y2: worldPos.y, color: currentColor, style: currentLineStyle };
        } else if (currentTool === 'rect') {
            tempElement = { type: 'rect', x: worldPos.x, y: worldPos.y, w: 0, h: 0, color: currentColor, style: currentLineStyle };
        }
        render();
    }

    function handleMouseMove(e) {
        if (isDraggingCamera) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            
            camera.x -= dx / camera.zoom;
            camera.y -= dy / camera.zoom;
            
            lastMousePos = { x: e.clientX, y: e.clientY };
            render();
            return;
        }

        if (!drawingInProgress) return;
        
        e.preventDefault();
        const worldPos = getMouseWorld(e, true);

        if (currentTool === 'vector') {
            render();
            return;
        }

        if (tempElement) {
            if (tempElement.type === 'line') {
                tempElement.x2 = worldPos.x;
                tempElement.y2 = worldPos.y;
            } else if (tempElement.type === 'rect') {
                tempElement.w = worldPos.x - startPoint.x;
                tempElement.h = worldPos.y - startPoint.y;
            }
        }
        render();
    }

    function handleMouseUp(e) {
        if (isDraggingCamera) {
            isDraggingCamera = false;
            wrapper.style.cursor = 'grab';
            return;
        }

        if (!drawingInProgress) return;

        if (currentTool === 'vector' || currentTool === 'arc') {
            render();
            return;
        }

        if (tempElement) {
            if (tempElement.type === 'line') {
                if (Math.abs(tempElement.x1 - tempElement.x2) > 0.1 || Math.abs(tempElement.y1 - tempElement.y2) > 0.1) {
                    elements.push({ ...tempElement });
                    saveHistory();
                }
            } else if (tempElement.type === 'rect') {
                if (Math.abs(tempElement.w) > 1 && Math.abs(tempElement.h) > 1) {
                    elements.push({ ...tempElement });
                    saveHistory();
                }
            }
        }

        drawingInProgress = false;
        tempElement = null;
        render();
    }

    function handleDoubleClick(e) {
        if (currentTool === 'vector' && drawingInProgress && vectorPoints.length >= 2) {
            elements.push({
                type: 'vector',
                points: [...vectorPoints],
                color: currentColor,
                style: currentLineStyle
            });
            drawingInProgress = false;
            tempElement = null;
            vectorPoints = [];
            saveHistory();
            render();
        }
    }

    function handleWheel(e) {
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const worldBefore = screenToWorld(mouseX, mouseY);
        
        const delta = -Math.sign(e.deltaY) * 0.1;
        camera.zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, camera.zoom + delta));
        
        const worldAfter = screenToWorld(mouseX, mouseY);
        
        camera.x += worldBefore.x - worldAfter.x;
        camera.y += worldBefore.y - worldAfter.y;
        
        document.getElementById('zoomPercent').innerText = Math.round(camera.zoom * 100) + '%';
        render();
    }

    // ----- Редактирование и удаление -----
    function applyEdit() {
        if (!selectedElement) return;

        const newColor = document.getElementById('editColor').value;
        const newStyle = document.getElementById('editStyle').value;

        selectedElement.color = newColor;
        selectedElement.style = newStyle;

        if (selectedElement.type === 'text') {
            const newText = document.getElementById('editText').value;
            if (newText) selectedElement.text = newText;
        }

        saveHistory();
        render();
    }

    function deleteSelected() {
        if (selectedElementIndex >= 0) {
            elements.splice(selectedElementIndex, 1);
            selectedElement = null;
            selectedElementIndex = -1;
            hideEditPanel();
            saveHistory();
            render();
        }
    }

    // ----- Масштабирование -----
    function zoomIn() {
        camera.zoom = Math.min(camera.maxZoom, camera.zoom + 0.2);
        document.getElementById('zoomPercent').innerText = Math.round(camera.zoom * 100) + '%';
        render();
    }

    function zoomOut() {
        camera.zoom = Math.max(camera.minZoom, camera.zoom - 0.2);
        document.getElementById('zoomPercent').innerText = Math.round(camera.zoom * 100) + '%';
        render();
    }

    function resetView() {
        camera.x = 0;
        camera.y = 0;
        camera.zoom = 1.0;
        document.getElementById('zoomPercent').innerText = '100%';
        render();
    }

    // ----- Инициализация слушателей -----
    function initEventListeners() {
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('dblclick', handleDoubleClick);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTool = btn.dataset.tool;
                
                drawingInProgress = false;
                tempElement = null;
                arcPoints = [];
                vectorPoints = [];
                
                document.getElementById('toolStatus').innerText = `✦ ${btn.dataset.tool === 'select' ? 'Выделение' : btn.dataset.tool === 'line' ? 'Линия' : btn.dataset.tool === 'rect' ? 'Прямоугольник' : btn.dataset.tool === 'arc' ? 'Дуга (3 точки)' : btn.dataset.tool === 'text' ? 'Текст' : 'Вектор'}`;
                render();
            });
        });

        document.getElementById('colorInput').addEventListener('input', (e) => {
            currentColor = e.target.value;
        });

        document.getElementById('lineStyleSelect').addEventListener('change', (e) => {
            currentLineStyle = e.target.value;
        });

        document.getElementById('undoBtn').addEventListener('click', undo);
        document.getElementById('redoBtn').addEventListener('click', redo);
        
        document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
        document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
        document.getElementById('resetViewBtn').addEventListener('click', resetView);

        document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

        document.getElementById('saveScreenBtn').addEventListener('click', () => {
            const dataURL = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `draft-${Date.now()}.png`;
            link.href = dataURL;
            link.click();
        });

        document.getElementById('saveFileBtn').addEventListener('click', () => {
            const project = {
                version: '2.0',
                elements: elements,
                gridSize: GRID_SIZE
            };
            const json = JSON.stringify(project, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `project-${Date.now()}.draft`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        });

        document.getElementById('openFileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const project = JSON.parse(ev.target.result);
                    if (project.elements) {
                        elements = project.elements;
                        resetDrawingState();
                        saveHistory();
                        render();
                    } else {
                        alert('Неверный формат файла');
                    }
                } catch (ex) {
                    alert('Ошибка чтения файла');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        document.getElementById('clearCanvasBtn').addEventListener('click', () => {
            if (confirm('Очистить весь чертёж?')) {
                elements = [];
                selectedElement = null;
                hideEditPanel();
                resetDrawingState();
                saveHistory();
                render();
            }
        });

        document.getElementById('applyEditBtn').addEventListener('click', applyEdit);
        document.getElementById('deleteObjBtn').addEventListener('click', deleteSelected);

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    undo();
                } else if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
                    redo();
                } else if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    zoomIn();
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    zoomOut();
                }
            } else if (e.key === 'Escape') {
                selectedElement = null;
                hideEditPanel();
                drawingInProgress = false;
                tempElement = null;
                arcPoints = [];
                vectorPoints = [];
                render();
            } else if (e.key === 'Delete' || e.key === 'Del') {
                deleteSelected();
            }
        });
    }

    function resetDrawingState() {
        drawingInProgress = false;
        tempElement = null;
        arcPoints = [];
        vectorPoints = [];
    }

    // Старт
    initEventListeners();
    initDemo();
})();
