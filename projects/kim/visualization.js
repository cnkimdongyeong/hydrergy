// ============================================================
// visualization.js — 数字孪生 3D 工厂（工业设备级建模）
// 依赖 Three.js r160 与 Chart.js v4
// 说明：场景单位 1 = 1 米，全部按 fconfig.json 尺寸建模
// ============================================================

let scene, camera, renderer;
let deviceMeshes = {};
let animClock;
let chartEnergyFlow, chart24h, chartCumulative;
let simTimer = null;
let simSpeed = 1000;
let labels = [];
const labelMap = {};

const FACTORY_GROUND = { w: 200, h: 150 };

// 材质库
const MAT = {};
function initMaterials() {
    MAT.steel = new THREE.MeshStandardMaterial({ color: 0x9aafc2, metalness: 0.9, roughness: 0.32 });
    MAT.darkSteel = new THREE.MeshStandardMaterial({ color: 0x4c6076, metalness: 0.85, roughness: 0.45 });
    MAT.concrete = new THREE.MeshStandardMaterial({ color: 0x6b8095, metalness: 0.05, roughness: 0.92 });
    MAT.rail = new THREE.MeshStandardMaterial({ color: 0xd6b13a, metalness: 0.7, roughness: 0.5 });
    MAT.pipe = new THREE.MeshStandardMaterial({ color: 0x7f93a6, metalness: 0.95, roughness: 0.25 });
    MAT.pipeH2 = new THREE.MeshStandardMaterial({ color: 0x2fb6c9, metalness: 0.6, roughness: 0.3, emissive: 0x0a5560, emissiveIntensity: 0.5 });
    MAT.pipeCO2 = new THREE.MeshStandardMaterial({ color: 0x67a34a, metalness: 0.6, roughness: 0.35, emissive: 0x1d4416, emissiveIntensity: 0.4 });
    MAT.pipeMeOH = new THREE.MeshStandardMaterial({ color: 0xc07a3c, metalness: 0.6, roughness: 0.35, emissive: 0x4a2a10, emissiveIntensity: 0.4 });
    MAT.panel = new THREE.MeshStandardMaterial({ color: 0x14365c, metalness: 0.75, roughness: 0.18, emissive: 0x0a4d8c, emissiveIntensity: 0.25 });
    MAT.electrolyzer = new THREE.MeshStandardMaterial({ color: 0x2b7cc0, metalness: 0.8, roughness: 0.35, emissive: 0x0a2b4d, emissiveIntensity: 0.3 });
    MAT.capture = new THREE.MeshStandardMaterial({ color: 0x5b8f45, metalness: 0.75, roughness: 0.4, emissive: 0x12300d, emissiveIntensity: 0.25 });
    MAT.methanol = new THREE.MeshStandardMaterial({ color: 0xbf6a2b, metalness: 0.8, roughness: 0.35, emissive: 0x3a1a05, emissiveIntensity: 0.3 });
    MAT.cellGreen = new THREE.MeshStandardMaterial({ color: 0x44cc55, metalness: 0.5, roughness: 0.4, emissive: 0x115522, emissiveIntensity: 0.6 });
    MAT.glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.35 });
    // 电气：桥架槽体 + 电缆
    MAT.tray = new THREE.MeshStandardMaterial({ color: 0x8fa2b5, metalness: 0.9, roughness: 0.3 });
    MAT.cable = new THREE.MeshStandardMaterial({ color: 0xffb733, metalness: 0.35, roughness: 0.55, emissive: 0x6b4500, emissiveIntensity: 0.45 });
    // 压力容器壳体（半透明，便于观察料位）
    MAT.vesselShell = new THREE.MeshStandardMaterial({
        color: 0xe8f2fa, metalness: 0.75, roughness: 0.18,
        transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false
    });
}

// ============================================================
// 3D 初始化
// ============================================================
function initThreeD(containerId = 'factory-3d') {
    const container = document.getElementById(containerId);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1626);
    scene.fog = new THREE.Fog(0x0a1626, 300, 700);

    camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.5, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    initMaterials();

    // 光照：环境 + 半球 + 定向太阳（带阴影）
    scene.add(new THREE.AmbientLight(0x9fc0de, 0.85));
    scene.add(new THREE.HemisphereLight(0xa9d1f5, 0x27384a, 0.75));

    const sun = new THREE.DirectionalLight(0xfff2d0, 2.0);
    sun.position.set(90, 120, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 130;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.userData.sunLight = sun;

    const fill = new THREE.DirectionalLight(0x6f9ec4, 0.5);
    fill.position.set(-80, 60, -70);
    scene.add(fill);
    scene.userData.fillLight = fill;

    buildFactoryGround();
    buildAllDevices();
    buildConnections();
    buildSurroundings();

    animClock = new THREE.Clock();
    animateLoop();
    attachMouseControls(container);
}

// ============================================================
// 基础工具
// ============================================================
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}
function cyl(rt, rb, h, mat, seg = 24, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// 悬空标签（Canvas 贴图 Sprite，始终朝向相机）
function makeLabel(key, title, subtitle, color = '#4fc3ff', pos = [0, 0, 0], scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 168;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false
    }));
    sprite.scale.set(26 * scale, 8.5 * scale, 1);
    sprite.position.set(pos[0], pos[1], pos[2]);
    sprite.renderOrder = 20;
    sprite.userData = { canvas, ctx, tex, title, subtitle, color };
    drawLabel(sprite);
    scene.add(sprite);
    labels.push(sprite);
    labelMap[key] = sprite;
    return sprite;
}
function drawLabel(sprite) {
    const { canvas, ctx, tex, title, subtitle, color } = sprite.userData;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6,16,28,0.86)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 26);
    ctx.fill(); ctx.stroke();
    // 左侧色条
    ctx.fillStyle = color;
    roundRect(ctx, 22, 34, 10, 100, 5); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px "Microsoft YaHei", sans-serif';
    ctx.fillText(title, canvas.width / 2 + 8, 60);
    ctx.fillStyle = color;
    ctx.font = '42px "Microsoft YaHei", sans-serif';
    ctx.fillText(subtitle, canvas.width / 2 + 8, 118);
    tex.needsUpdate = true;
}
function setLabel(sprite, subtitle) {
    if (sprite.userData.subtitle === subtitle) return;
    sprite.userData.subtitle = subtitle;
    drawLabel(sprite);
}

// ============================================================
// 场地
// ============================================================
function buildFactoryGround() {
    // 混凝土场坪
    const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(FACTORY_GROUND.w, FACTORY_GROUND.h),
        new THREE.MeshStandardMaterial({ color: 0x37495c, roughness: 0.95, metalness: 0.05 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    scene.add(pad);

    // 场坪分格缝
    const lines = new THREE.Group();
    const lm = new THREE.LineBasicMaterial({ color: 0x4d6a86, transparent: true, opacity: 0.25 });
    for (let x = -90; x <= 90; x += 20) {
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0.02, -75), new THREE.Vector3(x, 0.02, 75)
        ]);
        lines.add(new THREE.Line(g, lm));
    }
    for (let z = -70; z <= 70; z += 20) {
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-100, 0.02, z), new THREE.Vector3(100, 0.02, z)
        ]);
        lines.add(new THREE.Line(g, lm));
    }
    scene.add(lines);

    // 区内道路：南北主干道 + 北侧进场道路（不穿越生产区，避免管线跨路）
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 1 });
    const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(9, 150), roadMat);
    roadNS.rotation.x = -Math.PI / 2; roadNS.position.set(-27, 0.03, 0);
    roadNS.receiveShadow = true; scene.add(roadNS);
    const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(196, 9), roadMat);
    roadEW.rotation.x = -Math.PI / 2; roadEW.position.set(0, 0.03, -66);
    roadEW.receiveShadow = true; scene.add(roadEW);

    // 场界围栏
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x6a8199, metalness: 0.8, roughness: 0.4 });
    const fence = new THREE.Group();
    for (let x = -98; x <= 98; x += 7) {
        fence.add(box(0.18, 2.2, 0.18, fenceMat, x, 1.1, -73));
        fence.add(box(0.18, 2.2, 0.18, fenceMat, x, 1.1, 73));
    }
    for (let z = -70; z <= 70; z += 7) {
        fence.add(box(0.18, 2.2, 0.18, fenceMat, -98, 1.1, z));
        fence.add(box(0.18, 2.2, 0.18, fenceMat, 98, 1.1, z));
    }
    scene.add(fence);
}

// ============================================================
// 设备建模
// ============================================================
function buildAllDevices() {
    buildSolarFarm();
    buildElectrolyzer();
    buildCarbonCapture();
    buildMethanolPlant();
    buildBufferTanks();
    buildBatteryBank();
    buildGridConnection();
    buildLoadingStation();
}

// —— 太阳能农场：倾斜组件阵列 + 支架 + 汇流箱 ——
function buildSolarFarm() {
    const g = new THREE.Group();
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2c3f52, roughness: 1 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(54, 70), padMat);
    pad.rotation.x = -Math.PI / 2; pad.position.set(-66, 0.04, 0); pad.receiveShadow = true;
    g.add(pad);

    const frameMat = MAT.steel;
    const panelMat = MAT.panel.clone();
    const rows = 7, cols = 5;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cx = -85.5 + c * 9.5;   // -85.5 → -47.5
            const cz = -27 + r * 9;       // -27 → 27
            // 支架
            const legH = 1.6;
            g.add(box(0.22, legH + 0.6, 0.22, frameMat, cx - 3.1, (legH + 0.6) / 2, cz + 1.3));
            g.add(box(0.22, legH, 0.22, frameMat, cx - 3.1, legH / 2, cz - 1.3));
            g.add(box(0.22, legH, 0.22, frameMat, cx + 3.1, legH / 2, cz - 1.3));
            g.add(box(0.22, legH + 0.6, 0.22, frameMat, cx + 3.1, (legH + 0.6) / 2, cz + 1.3));
            // 组件（倾斜 25°）
            const panel = box(7.4, 0.14, 3.4, panelMat, cx, legH + 0.42, cz);
            panel.rotation.x = -0.44;
            g.add(panel);
            // 组件边框
            const frame = box(7.6, 0.06, 3.55, frameMat, cx, legH + 0.36, cz);
            frame.rotation.x = -0.44;
            g.add(frame);
        }
    }
    // 直流汇流箱（阵列东侧边缘）
    g.add(box(1.6, 1.8, 0.9, MAT.darkSteel, -41.5, 0.9, -14));
    g.add(box(1.6, 1.8, 0.9, MAT.darkSteel, -41.5, 0.9, 14));
    // 逆变器房（阵列东侧，道路以西）
    const invHouse = box(5, 3, 3.4, MAT.concrete, -34.5, 1.5, -6);
    g.add(invHouse);
    g.add(box(5.2, 0.25, 3.6, MAT.darkSteel, -34.5, 3.1, -6));

    g.position.set(0, 0, 0);
    scene.add(g);
    deviceMeshes.solar = { group: g, panelMat };
    makeLabel('solar', '太阳能阵列', '0 kW', '#ffcc33', [-66, 16, 0]);
}

// —— 电解槽：撬装底座 + 4 台电解堆 + 气液分离 + 控制柜 ——
function buildElectrolyzer() {
    const g = new THREE.Group();
    // 撬装底座
    g.add(box(15, 0.5, 9, MAT.darkSteel, 0, 0.25, 0));
    // 4 台电解堆
    const stacks = [];
    for (let i = 0; i < 4; i++) {
        const x = -5.4 + i * 3.6;
        const stack = cyl(1.35, 1.35, 3.6, MAT.electrolyzer.clone(), 20, x, 2.3, -1.4);
        g.add(stack);
        stacks.push(stack);
        // 端盖
        g.add(cyl(1.45, 1.45, 0.3, MAT.steel, 20, x, 4.25, -1.4));
        g.add(cyl(1.45, 1.45, 0.3, MAT.steel, 20, x, 0.35, -1.4));
        // 加强环
        for (let k = 1; k <= 3; k++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 20), MAT.steel);
            ring.rotation.x = Math.PI / 2;
            ring.position.set(x, 0.5 + k * 0.9, -1.4);
            g.add(ring);
        }
    }
    // 气液分离罐（H2 / O2）
    g.add(cyl(1.0, 1.0, 3.2, MAT.steel, 18, 6.2, 1.9, 2.4));
    g.add(cyl(0.55, 0.55, 1.1, MAT.steel, 16, 6.2, 4.0, 2.4));
    g.add(cyl(1.0, 1.0, 3.2, MAT.steel, 18, 3.4, 1.9, 2.4));
    // 控制柜
    g.add(box(2.2, 2.4, 1.2, MAT.darkSteel, -7.6, 1.2, 2.6));
    g.add(box(0.1, 1.2, 0.8, MAT.glass, -6.45, 1.6, 2.6));
    // 安全护栏
    addRailing(g, 15.4, 9.4, 0, 0);

    g.position.set(14, 0, -44);
    scene.add(g);
    deviceMeshes.electrolyzer = { group: g, stacks, mainBox: stacks[1] };
    makeLabel('electrolyzer', '电解槽', '0 kW · 0 kg H₂/h', '#4fc3ff', [14, 18, -44]);
}

// —— 碳捕获：吸收塔 + 再生塔 + 烟道 + 平台 ——
function buildCarbonCapture() {
    const g = new THREE.Group();
    g.add(box(18, 0.6, 14, MAT.darkSteel, 0, 0.3, 0));

    // 吸收塔（高）
    const absorber = cyl(2.6, 2.8, 20, MAT.capture.clone(), 28, -4, 10.6, -2);
    g.add(absorber);
    g.add(cyl(2.9, 2.9, 0.5, MAT.steel, 28, -4, 20.9, -2));
    // 塔顶出口
    g.add(cyl(0.9, 0.9, 2.6, MAT.darkSteel, 16, -4, 22.4, -2));
    // 再生塔
    const stripper = cyl(2.0, 2.2, 15, MAT.capture.clone(), 24, 4.5, 8.1, -2);
    g.add(stripper);
    g.add(cyl(2.3, 2.3, 0.4, MAT.steel, 24, 4.5, 15.8, -2));
    // 平台
    for (const y of [6, 12, 18]) {
        const plat = cyl(3.4, 3.4, 0.22, MAT.steel, 24, -4, y, -2);
        g.add(plat);
        for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            g.add(box(0.12, 1.1, 0.12, MAT.rail, -4 + Math.cos(ang) * 3.3, y + 0.6, -2 + Math.sin(ang) * 3.3));
        }
    }
    // 直梯
    for (let y = 0.8; y < 19; y += 1.2) {
        g.add(box(0.08, 0.08, 0.9, MAT.rail, -7.2, y, -2));
    }
    g.add(box(0.1, 20, 0.1, MAT.rail, -7.2, 10, -2.45));
    g.add(box(0.1, 20, 0.1, MAT.rail, -7.2, 10, -1.55));
    // 烟气入口 + 引风机
    g.add(cyl(0.85, 0.85, 5.6, MAT.pipe, 16, -4, 4.4, 4.2).rotateX(Math.PI / 2));
    const fan = cyl(1.2, 1.2, 1.0, MAT.darkSteel, 20, -4, 1.2, 6.6);
    fan.rotation.x = Math.PI / 2; g.add(fan);
    // 贫富液泵
    g.add(cyl(0.6, 0.6, 1.2, MAT.steel, 14, 6.2, 1.2, 3.2));
    g.add(cyl(0.6, 0.6, 1.2, MAT.steel, 14, 2.8, 1.2, 3.2));
    addRailing(g, 18.4, 14.4, 0, 0);

    g.position.set(46, 0, -34);
    scene.add(g);
    deviceMeshes.carbon_capture = { group: g, mainBody: absorber, stack: g.children[4] };
    makeLabel('capture', '碳捕获装置', '0 kW · 0 kg CO₂/h', '#6fd07a', [46, 34, -34]);
}

// —— CH3OH 合成：反应器 + 精馏塔 + 换热器 + 成品罐 ——
function buildMethanolPlant() {
    const g = new THREE.Group();
    g.add(box(20, 0.6, 14, MAT.darkSteel, 0, 0.3, 0));

    // 合成反应器（立式）
    const reactor = cyl(1.9, 1.9, 9, MAT.methanol.clone(), 24, -6, 5.1, -2);
    g.add(reactor);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.methanol);
    dome.position.set(-6, 9.6, -2);
    dome.castShadow = true;
    g.add(dome);
    // 精馏塔
    const column = cyl(1.5, 1.7, 16, MAT.methanol.clone(), 22, 0.5, 8.6, -2);
    g.add(column);
    g.add(cyl(1.8, 1.8, 0.4, MAT.steel, 22, 0.5, 16.8, -2));
    for (let y = 4; y < 16; y += 3.4) {
        const plat = cyl(2.1, 2.1, 0.18, MAT.steel, 20, 0.5, y, -2);
        g.add(plat);
    }
    // 换热器组（卧式）
    for (let i = 0; i < 2; i++) {
        const hx = cyl(1.0, 1.0, 4.2, MAT.steel, 18, 6.4, 1.5, -2 + i * 3.2);
        hx.rotation.z = Math.PI / 2; g.add(hx);
    }
    // 循环压缩机
    g.add(cyl(1.1, 1.1, 2.0, MAT.darkSteel, 18, 8.2, 1.4, 2.8));
    // 成品甲醇储罐（卧式）
    const tank = cyl(2.2, 2.2, 6.5, MAT.methanol, 24, 4.5, 2.4, 5.2);
    tank.rotation.z = Math.PI / 2; g.add(tank);
    const tankCap = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.methanol);
    tankCap.rotation.z = -Math.PI / 2;
    tankCap.position.set(7.75, 2.4, 5.2);
    tankCap.castShadow = true;
    g.add(tankCap);
    // 管廊
    for (let x = -8; x <= 8; x += 4) {
        g.add(box(0.16, 3.2, 0.16, MAT.steel, x, 1.6, 1.4));
    }
    g.add(box(16.5, 0.16, 0.5, MAT.steel, 0, 3.2, 1.0));
    g.add(box(16.5, 0.16, 0.5, MAT.steel, 0, 3.2, 1.9));
    addRailing(g, 20.4, 14.4, 0, 0);

    g.position.set(6, 0, 40);
    scene.add(g);
    deviceMeshes.ch3oh = { group: g, reactor, hx: g.children[7] };
    makeLabel('methanol', 'CH₃OH 合成装置', '0 kW · 0 kg/h', '#ff9a3c', [8, 28, 42]);
}

// —— 电池储能：集装箱 + 冷却 + 升压变 ——
function buildBatteryBank() {
    const g = new THREE.Group();
    g.add(box(30, 0.4, 16, MAT.concrete, 0, 0.2, 0));

    const cells = [];
    for (let i = 0; i < 3; i++) {
        const x = -10 + i * 10.5;
        // 集装箱外壳
        g.add(box(9.4, 3.0, 5.4, MAT.darkSteel, x, 1.9, -2.5));
        g.add(box(9.6, 0.2, 5.6, MAT.steel, x, 3.5, -2.5));
        // 电芯显示面（SOC 上色）
        const cellMat = MAT.cellGreen.clone();
        const screen = box(8.4, 1.9, 0.12, cellMat, x, 1.95, 0.22);
        g.add(screen);
        cells.push(screen);
        // 冷却机组
        const fan = cyl(0.75, 0.75, 0.45, MAT.steel, 16, x + 3.2, 1.6, 0.6);
        fan.rotation.x = Math.PI / 2; g.add(fan);
        // 电缆桥架
        g.add(box(9.4, 0.22, 0.5, MAT.rail, x, 3.8, 0.4));
    }
    // 升压变压器
    g.add(box(4.2, 3.4, 3.2, MAT.darkSteel, 12.5, 1.8, -2.5));
    for (let i = 0; i < 3; i++) {
        g.add(cyl(0.28, 0.28, 1.5, MAT.steel, 12, 9.4 + i * 1.1, 4.5, -2.5));
    }
    // 消防舱
    g.add(box(2.4, 2.2, 2.0, MAT.darkSteel, -15.5, 1.1, 4.2));
    addRailing(g, 30.4, 16.4, 0, 0);

    g.position.set(-62, 0, 46);
    scene.add(g);
    deviceMeshes.battery = { group: g, cells };
    makeLabel('battery', '电池储能', '0% SOC', '#44ff88', [-74, 22, 46]);
}

// —— 电网接入：格构式塔 + 变压器 + 母线 ——
function buildGridConnection() {
    const g = new THREE.Group();
    const towerMat = MAT.steel;
    // 四腿格构塔
    const legW = 3.2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = box(0.28, 26, 0.28, towerMat, sx * legW, 13, sz * legW);
        leg.rotation.z = -sx * 0.035; leg.rotation.x = sz * 0.035;
        g.add(leg);
    }
    // 横撑
    for (let y = 3; y < 25; y += 3.4) {
        g.add(box(legW * 2, 0.16, 0.16, towerMat, 0, y, -legW));
        g.add(box(legW * 2, 0.16, 0.16, towerMat, 0, y, legW));
        g.add(box(0.16, 0.16, legW * 2, towerMat, -legW, y, 0));
        g.add(box(0.16, 0.16, legW * 2, towerMat, legW, y, 0));
    }
    // 横担
    for (let i = 0; i < 2; i++) {
        const y = 22 + i * 3;
        g.add(box(13, 0.3, 0.3, towerMat, 0, y, 0));
        for (const sx of [-6, -3, 3, 6]) {
            g.add(cyl(0.16, 0.16, 1.2, MAT.glass, 10, sx, y - 0.75, 0));
        }
    }
    // 主变
    g.add(box(5.5, 3.8, 4.2, MAT.darkSteel, 10, 2.1, 0));
    for (let i = 0; i < 3; i++) g.add(cyl(0.32, 0.32, 1.8, MAT.steel, 12, 8.5 + i * 1.4, 4.9, 0));
    // 配电柜
    for (let i = 0; i < 3; i++) g.add(box(1.2, 2.2, 1.0, MAT.darkSteel, 14.5, 1.1, -4 + i * 1.6));

    g.position.set(-60, 0, -55);
    scene.add(g);
    deviceMeshes.grid = { group: g };
    makeLabel('grid', '电网接入', '0 kW', '#9fb5cc', [-60, 38, -55]);
}

function addRailing(group, w, d, cx, cz) {
    const h = 1.1;
    const step = 2.2;
    for (let x = -w / 2; x <= w / 2; x += step) {
        group.add(box(0.1, h, 0.1, MAT.rail, cx + x, h / 2, cz - d / 2));
        group.add(box(0.1, h, 0.1, MAT.rail, cx + x, h / 2, cz + d / 2));
    }
    for (let z = -d / 2; z <= d / 2; z += step) {
        group.add(box(0.1, h, 0.1, MAT.rail, cx - w / 2, h / 2, cz + z));
        group.add(box(0.1, h, 0.1, MAT.rail, cx + w / 2, h / 2, cz + z));
    }
    group.add(box(w, 0.09, 0.09, MAT.rail, cx, h, cz - d / 2));
    group.add(box(w, 0.09, 0.09, MAT.rail, cx, h, cz + d / 2));
    group.add(box(0.09, 0.09, d, MAT.rail, cx - w / 2, h, cz));
    group.add(box(0.09, 0.09, d, MAT.rail, cx + w / 2, h, cz));
}

// ============================================================
// 工艺管道（贴地管廊，带弯头）
// ============================================================
function makePipe(points, radius, mat) {
    const group = new THREE.Group();
    for (let i = 0; i < points.length - 1; i++) {
        const a = new THREE.Vector3(...points[i]);
        const b = new THREE.Vector3(...points[i + 1]);
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        if (len < 0.001) continue;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), mat);
        m.position.copy(a).addScaledVector(dir, 0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        m.castShadow = true;
        group.add(m);
        // 弯头球
        if (i < points.length - 2) {
            const j = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.25, 10, 8), mat);
            j.position.copy(b);
            group.add(j);
        }
    }
    return group;
}
function buildPipes() {
    // 旧版随意走线已废弃，改为 buildConnections()
}

// ============================================================
// 管线与桥架：严格按设备接口走线（正交布置，不穿越设备）
//   工艺管道标高 1.30 m，电缆桥架标高 2.60 m
//   接口基准：
//     电解槽  (14,-44) 15×9   → 东面 x=21.5 出 H₂；北面 z=-39.5 进电
//     碳捕获  (46,-34) 18×14  → 西面 x=37   出 CO₂；北面 z=-27 进电
//     CH₃OH   (6,40)   20×14  → 北面 z=33   进 H₂/CO₂；东面 x=16 出成品
//     电池    (-62,46) 30×16  → 北面 z=38   进电
//     逆变器  (-34.5,-6)      → 东面 x=-32  出 AC
//     主变    (-50,-55)       → 出线向东接主干
// ============================================================
const PROC_Y = 1.30;
const ELEC_Y = 2.60;

// 管道支墩
function addPipeSupports(points, radius) {
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (len < 4 || Math.abs(b[1] - a[1]) > 0.05) continue;
        const n = Math.max(1, Math.floor(len / 7));
        for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            const x = a[0] + (b[0] - a[0]) * t;
            const z = a[2] + (b[2] - a[2]) * t;
            const h = Math.max(0.2, a[1] - radius - 0.05);
            const post = box(0.42, h, 0.42, MAT.concrete, x, h / 2, z);
            scene.add(post);
        }
    }
}

// 电缆桥架（槽体 + 三芯电缆 + 弯头）
function makeTray(points) {
    const g = new THREE.Group();
    for (let i = 0; i < points.length - 1; i++) {
        const a = new THREE.Vector3(...points[i]);
        const b = new THREE.Vector3(...points[i + 1]);
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        if (len < 0.01) continue;
        const dirN = dir.clone().normalize();
        const tray = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.62), MAT.tray);
        tray.position.copy(a).addScaledVector(dir, 0.5);
        tray.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dirN);
        tray.castShadow = true; tray.receiveShadow = true;
        g.add(tray);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, len - 0.1, 8), MAT.cable);
        cab.position.copy(a).addScaledVector(dir, 0.5).add(new THREE.Vector3(0, 0.14, 0));
        cab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirN);
        g.add(cab);
        if (i < points.length - 2) {
            const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8), MAT.tray);
            elbow.position.copy(b);
            g.add(elbow);
        }
    }
    return g;
}

// 桥架支架（每 ~9 m 一根立柱）
function addTraySupports(points) {
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (len < 5 || Math.abs(b[1] - a[1]) > 0.05) continue;
        const n = Math.max(1, Math.round(len / 9));
        for (let k = 0; k <= n; k++) {
            const t = k / n;
            const x = a[0] + (b[0] - a[0]) * t;
            const z = a[2] + (b[2] - a[2]) * t;
            const h = a[1] - 0.08;
            scene.add(box(0.2, h, 0.2, MAT.steel, x, h / 2, z));
        }
    }
}

function buildConnections() {
    const p = (x, z, y = PROC_Y) => [x, y, z];
    const e = (x, z) => [x, ELEC_Y, z];

    // ---------------- 一、物料管线 ----------------
    // A1 电解槽 H₂ 出口 → H₂ 缓冲罐（南侧接管）
    const h2Feed = [p(21.5, -41.6), p(26, -41.6), p(26, -32.8)];
    // A2 H₂ 缓冲罐（北侧接管）→ 西行 → 南下 → CH₃OH 北面进料
    const h2ToMeOH = [p(26, -27.2), p(26, -12), p(2, -12), p(2, 33)];
    // A3 碳捕获 CO₂ 出口 → CO₂ 缓冲罐（南侧接管）
    const co2Feed = [p(37, -38), p(35, -38), p(35, -16.2)];
    // A4 CO₂ 缓冲罐（北侧接管）→ 西行 → 南下 → CH₃OH 北面进料
    const co2ToMeOH = [p(35, -9.8), p(10, -9.8), p(10, 33)];
    // A5 CH₃OH 成品出口 → 装车台
    const meohOut = [p(16, 45), p(24, 45), p(24, 54), p(27, 54)];

    const lines = [
        [h2Feed, 0.2, MAT.pipeH2],
        [h2ToMeOH, 0.2, MAT.pipeH2],
        [co2Feed, 0.2, MAT.pipeCO2],
        [co2ToMeOH, 0.2, MAT.pipeCO2],
        [meohOut, 0.16, MAT.pipeMeOH]
    ];
    for (const [pts, r, mat] of lines) {
        scene.add(makePipe(pts, r, mat));
        addPipeSupports(pts, r);
    }

    // ---------------- 二、电力桥架 ----------------
    // 直流汇流箱 → 逆变器房西面
    const dcA = [[-41.5, 0.9, -14], [-39, 0.9, -14], [-39, 0.9, -6.6], [-37, 0.9, -6.6]];
    const dcB = [[-41.5, 0.9, 14], [-39, 0.9, 14], [-39, 0.9, -5.2], [-37, 0.9, -5.2]];

    // 逆变器房东面 → 主桥架（AC 母线西端）
    const pvAc = [e(-32, -6), e(-32, -8), e(-38, -8)];
    // 主桥架：东西向 AC 母线（z=-8），从变压器侧到碳捕获支线端
    const spine = [e(-38, -8), e(46, -8)];
    // 主干：南北向（x=-38），北端接主变、南端接电池
    const trunk = [e(-38, -55), e(-38, 38)];
    // 电网主变出线 → 主干北端
    const gridAc = [e(-50, -55), e(-38, -55)];
    // 电池北面 → 主干南端
    const battAc = [e(-62, 38), e(-38, 38)];
    // 用户支线（由主桥架垂直下引至设备接线口）
    const dropEl = [e(14, -8), e(14, -39.5)];
    const dropMeOH = [e(6, -8), e(6, 33)];
    const dropCC = [e(46, -8), e(46, -27)];

    const trays = [dcA, dcB, pvAc, spine, trunk, gridAc, battAc, dropEl, dropMeOH, dropCC];
    for (const t of trays) {
        scene.add(makeTray(t));
        addTraySupports(t);
    }
}

// ============================================================
// 原料缓冲罐（H₂ / CO₂）：半透明壳体 + 可视化料位
// ============================================================
function makeVessel(opt) {
    const { x, z, R, shellH, accent } = opt;
    const skirtH = 1.2;
    const g = new THREE.Group();

    // 裙座
    g.add(cyl(R * 0.8, R * 0.86, skirtH, MAT.darkSteel, 24, 0, skirtH / 2, 0));
    // 筒体（半透明，可看到内部料位）
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, shellH, 32, 1, true), MAT.vesselShell);
    shell.position.y = skirtH + shellH / 2;
    g.add(shell);
    // 上下封头
    const domeTop = new THREE.Mesh(new THREE.SphereGeometry(R, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.vesselShell);
    domeTop.position.y = skirtH + shellH;
    g.add(domeTop);
    const domeBot = new THREE.Mesh(new THREE.SphereGeometry(R, 26, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MAT.vesselShell);
    domeBot.position.y = skirtH;
    g.add(domeBot);
    // 加强圈
    for (let i = 1; i <= 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 6, 28), MAT.steel);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = skirtH + shellH * i / 3;
        ring.castShadow = true;
        g.add(ring);
    }
    // 料位（内部液柱，随存量升降）
    const levelMat = new THREE.MeshStandardMaterial({
        color: accent, emissive: accent, emissiveIntensity: 0.7,
        metalness: 0.1, roughness: 0.5, transparent: true, opacity: 0.92
    });
    const level = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, 1, 28), levelMat);
    level.position.y = skirtH + 0.5;
    g.add(level);
    // 外置磁翻板液位计（直观显示料位）
    const gaugeBg = new THREE.Mesh(new THREE.BoxGeometry(0.36, shellH, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x24323f, metalness: 0.5, roughness: 0.6 }));
    gaugeBg.position.set(R * 0.6, skirtH + shellH / 2, R + 0.12);
    g.add(gaugeBg);
    const gaugeFill = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.22),
        new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.4 }));
    gaugeFill.position.set(R * 0.6, skirtH + 0.5, R + 0.14);
    g.add(gaugeFill);
    // 直梯（西侧）
    g.add(box(0.1, skirtH + shellH, 0.1, MAT.rail, -R - 0.5, (skirtH + shellH) / 2, 0));
    g.add(box(0.1, skirtH + shellH, 0.1, MAT.rail, -R - 0.5, (skirtH + shellH) / 2, 1.0));
    for (let y = 0.5; y < skirtH + shellH - 0.4; y += 0.8) {
        g.add(box(0.06, 0.06, 1.05, MAT.rail, -R - 0.5, y, 0.5));
    }
    // 进出料接管（南北两侧，标高与工艺管道一致）
    for (const sz of [-1, 1]) {
        const stub = cyl(0.17, 0.17, 1.0, MAT.pipe, 12, 0, PROC_Y, sz * (R + 0.45));
        stub.rotation.x = Math.PI / 2;
        g.add(stub);
        const flange = cyl(0.28, 0.28, 0.14, MAT.steel, 12, 0, PROC_Y, sz * (R + 0.9));
        flange.rotation.x = Math.PI / 2;
        g.add(flange);
    }
    // 基础环
    g.add(cyl(R * 1.02, R * 1.05, 0.25, MAT.concrete, 26, 0, 0.12, 0));

    g.position.set(x, 0, z);
    scene.add(g);
    return { group: g, level, levelMat, gaugeFill, shellH, skirtH, R };
}

function buildBufferTanks() {
    const bt = (window.CONFIG && window.CONFIG.extra.buffer_tanks) || { h2_capacity_kg: 100, co2_capacity_kg: 726 };
    const fmt = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

    const h2 = makeVessel({ x: 26, z: -30, R: 2.8, shellH: 8.0, accent: 0x2fb6c9, cap: bt.h2_capacity_kg });
    h2.cap = bt.h2_capacity_kg;
    deviceMeshes.h2Tank = h2;
    makeLabel('h2tank', 'H₂ 缓冲罐', `0 / ${fmt(bt.h2_capacity_kg)} kg`, '#2fb6c9', [26, 13.5, -30], 0.6);

    const co2 = makeVessel({ x: 35, z: -13, R: 3.2, shellH: 8.5, accent: 0x67a34a });
    co2.cap = bt.co2_capacity_kg;
    deviceMeshes.co2Tank = co2;
    makeLabel('co2tank', 'CO₂ 缓冲罐', `0 / ${fmt(bt.co2_capacity_kg)} kg`, '#6fd07a', [35, 16.5, -13], 0.6);
}

// ============================================================
// CH₃OH 装车台
// ============================================================
function buildLoadingStation() {
    const g = new THREE.Group();
    g.add(box(12, 0.3, 9, MAT.concrete, 0, 0.15, 0));
    // 雨棚立柱 + 顶棚
    for (const [sx, sz] of [[-4, -3.4], [4, -3.4], [-4, 3.4], [4, 3.4]]) {
        g.add(box(0.24, 5.2, 0.24, MAT.steel, sx, 2.6, sz));
    }
    g.add(box(10.4, 0.3, 8.2, MAT.darkSteel, 0, 5.3, 0));
    // 装车泵 + 鹤管
    g.add(cyl(0.55, 0.55, 1.1, MAT.steel, 16, -3.6, 0.85, 0));
    g.add(cyl(0.15, 0.15, 3.0, MAT.pipeMeOH, 12, -1.6, 2.4, 0));
    g.add(box(1.4, 0.16, 0.16, MAT.pipeMeOH, -2.2, 3.9, 0));
    // 槽车位
    g.add(box(6.4, 0.1, 2.6, MAT.rail, 1.6, 0.36, 0));
    g.position.set(30, 0, 54);
    scene.add(g);
    makeLabel('loading', 'CH₃OH 装车台', '0 kg/h 外运', '#c07a3c', [30, 12, 54], 0.7);
}

// ============================================================
// 远景环境
// ============================================================
function buildSurroundings() {
    // 中央控制楼（两层，带玻璃幕墙）
    const ctrl = new THREE.Group();
    ctrl.add(box(22, 0.5, 13, MAT.concrete, 0, 0.25, 0));
    ctrl.add(box(20, 7, 11, MAT.concrete, 0, 3.8, 0));
    ctrl.add(box(20.6, 0.4, 11.6, MAT.darkSteel, 0, 7.6, 0));
    // 玻璃窗带
    ctrl.add(box(20.2, 2.2, 11.2, MAT.glass, 0, 5.4, 0));
    ctrl.add(box(20.2, 1.6, 11.2, MAT.glass, 0, 2.2, 0));
    // 入口雨棚
    ctrl.add(box(6, 0.25, 3, MAT.darkSteel, 0, 3.2, 6.4));
    ctrl.add(box(0.3, 3.2, 0.3, MAT.steel, -2.6, 1.6, 7.6));
    ctrl.add(box(0.3, 3.2, 0.3, MAT.steel, 2.6, 1.6, 7.6));
    // 屋顶设备
    ctrl.add(box(3, 1.2, 2.4, MAT.darkSteel, -6, 8.4, -2));
    ctrl.add(box(2.4, 1.0, 2.4, MAT.darkSteel, 6, 8.3, -2));
    ctrl.position.set(30, 0, 18);
    scene.add(ctrl);

    // 厂区大门
    const gate = new THREE.Group();
    gate.add(box(0.6, 5, 0.6, MAT.concrete, -5, 2.5, 0));
    gate.add(box(0.6, 5, 0.6, MAT.concrete, 5, 2.5, 0));
    gate.add(box(11, 0.7, 0.5, MAT.darkSteel, 0, 5, 0));
    const gd = box(0.25, 9, 9, MAT.darkSteel, 0, 4.5, 0);
    gate.add(gd);
    gate.add(box(4, 2.6, 3, MAT.concrete, 7.5, 1.3, 2));
    gate.position.set(0, 0, -73);
    scene.add(gate);

    const hillMat = new THREE.MeshStandardMaterial({ color: 0x1d3048, roughness: 1 });
    const hills = [[140, -120, 34, 26], [-150, 110, 40, 30], [160, 120, 30, 22], [-160, -110, 26, 18]];
    for (const [x, z, r, h] of hills) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), hillMat);
        m.position.set(x, h / 2 - 6, z);
        scene.add(m);
    }
    // 场地照明灯杆
    for (const [x, z] of [[-40, -60], [55, 60], [-60, 60], [60, -10], [30, 40]]) {
        const pole = box(0.22, 9, 0.22, MAT.steel, x, 4.5, z);
        scene.add(pole);
        scene.add(box(1.8, 0.3, 0.9, MAT.darkSteel, x, 9.1, z));
    }
    makeLabel('control', '中央控制室', 'DCS 集中监控', '#8fb8dd', [30, 13, 18]);
}

// ============================================================
// 动画
// ============================================================
function animateLoop() {
    requestAnimationFrame(animateLoop);
    animClock.getDelta();
    const t = animClock.elapsedTime;

    if (deviceMeshes.electrolyzer) {
        deviceMeshes.electrolyzer.stacks.forEach((s, i) => {
            s.rotation.y = t * 0.15 * (i % 2 ? 1 : -1);
        });
    }
    if (deviceMeshes.ch3oh) {
        deviceMeshes.ch3oh.reactor.rotation.y = t * 0.18;
    }
    if (deviceMeshes.battery) {
        deviceMeshes.battery.cells.forEach((c, i) => {
            c.scale.z = 1 + 0.25 * Math.sin(t * 2 + i);
        });
    }
    renderer.render(scene, camera);
}

// ============================================================
// 仿真驱动场景
// ============================================================
function updateThreeD(result, input) {
    const radiation = result.input_solar_forecast_kW;
    const pv = result.pv_output_kW || 0;
    const dayFrac = input.localHour / 24;
    const sun = scene.userData.sunLight;

    // 太阳轨迹与亮度
    sun.position.set(Math.cos(dayFrac * Math.PI * 2) * 110, Math.max(6, Math.sin(dayFrac * Math.PI) * 130), 70);
    sun.intensity = 0.25 + 2.1 * (radiation / 9500);
    scene.userData.fillLight.intensity = radiation < 200 ? 0.75 : 0.35;
    scene.background.setHex(radiation < 200 ? 0x050b16 : 0x0a1626);
    if (scene.fog) scene.fog.color.setHex(radiation < 200 ? 0x050b16 : 0x0a1626);

    // 光伏组件亮度
    if (deviceMeshes.solar) {
        deviceMeshes.solar.panelMat.emissiveIntensity = 0.1 + 0.75 * Math.min(1, pv / 1900);
    }

    // 电解槽负载
    const elPct = result.power_electrolyzer_kW / 4800;
    if (deviceMeshes.electrolyzer) {
        deviceMeshes.electrolyzer.stacks.forEach((s, i) => {
            s.material.emissiveIntensity = 0.12 + 0.55 * elPct;
            s.material.emissive.setHSL(0.56, 0.85, 0.12 + 0.2 * elPct);
            s.material.color.setHSL(0.56, 0.6, 0.3 + 0.1 * Math.sin(animClock.elapsedTime + i));
        });
    }

    // 碳捕获负载
    const ccPct = result.power_carbon_capture_kW / 5000;
    if (deviceMeshes.carbon_capture) {
        deviceMeshes.carbon_capture.mainBody.material.emissiveIntensity = 0.1 + 0.5 * ccPct;
    }

    // CH3OH 负载
    const mePct = result.power_ch3oh_synthesis_kW / 8000;
    if (deviceMeshes.ch3oh) {
        deviceMeshes.ch3oh.reactor.material.emissiveIntensity = 0.12 + 0.5 * mePct;
    }

    // 电池 SOC
    if (deviceMeshes.battery) {
        const soc = result.battery_soc_percent / 100;
        const charging = result.battery_charge_kW > 100;
        const discharging = result.battery_discharge_kW > 100;
        deviceMeshes.battery.cells.forEach(c => {
            if (discharging) {
                c.material.color.setHex(0xff8a33);
                c.material.emissive.setHex(0x7a3200);
                c.material.emissiveIntensity = 0.5 + 0.35 * Math.sin(animClock.elapsedTime * 5);
            } else if (charging) {
                c.material.color.setHex(0x4dff77);
                c.material.emissive.setHex(0x0f5c22);
                c.material.emissiveIntensity = 0.5 + 0.35 * Math.sin(animClock.elapsedTime * 5);
            } else {
                c.material.emissiveIntensity = 0.45;
                if (soc > 0.6) { c.material.color.setHex(0x3fcc55); c.material.emissive.setHex(0x0d4a18); }
                else if (soc > 0.3) { c.material.color.setHex(0xE0BE3A); c.material.emissive.setHex(0x4a3c00); }
                else { c.material.color.setHex(0xE0453F); c.material.emissive.setHex(0x4a0b0b); }
            }
        });
    }

    // 标签实时数值
    const nf = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
    if (labelMap.solar) setLabel(labelMap.solar, `辐射 ${nf(radiation)} kW → 出力 ${nf(pv)} kW`);
    if (labelMap.electrolyzer) setLabel(labelMap.electrolyzer, `${nf(result.power_electrolyzer_kW)} kW · ${nf(result.h2_production_kg_per_h, 1)} kg H₂/h`);
    if (labelMap.capture) setLabel(labelMap.capture, `${nf(result.power_carbon_capture_kW)} kW · ${nf(result.co2_captured_kg_per_h, 1)} kg CO₂/h`);
    if (labelMap.methanol) setLabel(labelMap.methanol, `${nf(result.power_ch3oh_synthesis_kW)} kW · ${nf(result.ch3oh_production_kg_per_h, 1)} kg/h`);
    if (labelMap.battery) {
        const mode = result.battery_discharge_kW > 100 ? '放电' : result.battery_charge_kW > 100 ? '充电' : '待机';
        setLabel(labelMap.battery, `${result.battery_soc_percent.toFixed(1)}% SOC · ${mode}`);
    }
    if (labelMap.grid) setLabel(labelMap.grid, `${nf(result.grid_to_load_kW)} kW`);

    // 原料缓冲罐：料位 + 存量
    updateTankLevel(deviceMeshes.h2Tank, result.tank_H2_kg, 'h2tank', 'H₂');
    updateTankLevel(deviceMeshes.co2Tank, result.tank_CO2_kg, 'co2tank', 'CO₂');
    if (labelMap.loading) setLabel(labelMap.loading, `${nf(result.ch3oh_production_kg_per_h, 1)} kg/h 外运`);
}

// 储罐料位：按“存量/设计缓冲量”计算液柱高度
function updateTankLevel(tank, kg, labelKey, name) {
    if (!tank) return;
    const ratio = Math.max(0.10, Math.min(1, (kg || 0) / tank.cap));   // 10% 为最低可见底量
    const h = ratio * tank.shellH;
    tank.level.scale.y = h;
    tank.level.position.y = tank.skirtH + h / 2;
    if (tank.gaugeFill) {
        tank.gaugeFill.scale.y = h;
        tank.gaugeFill.position.y = tank.skirtH + h / 2;
    }
    tank.levelMat.emissiveIntensity = 0.4 + 0.35 * Math.sin(animClock.elapsedTime * 2);
    const nf = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (labelMap[labelKey]) setLabel(labelMap[labelKey], `${nf(kg)} / ${nf(tank.cap)} kg`);
}

// ============================================================
// 相机控制
// ============================================================
let _orbit = { dragging: false, lastX: 0, lastY: 0, theta: 0.95, phi: 1.02, radius: 148, target: new THREE.Vector3(0, 3, -6) };
function attachMouseControls(container) {
    const canvas = renderer.domElement;
    canvas.addEventListener('mousedown', (e) => {
        _orbit.dragging = true; _orbit.lastX = e.clientX; _orbit.lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => { _orbit.dragging = false; canvas.style.cursor = 'grab'; });
    window.addEventListener('mousemove', (e) => {
        if (!_orbit.dragging) return;
        _orbit.theta -= (e.clientX - _orbit.lastX) * 0.005;
        _orbit.phi = Math.max(0.15, Math.min(Math.PI / 2.15, _orbit.phi - (e.clientY - _orbit.lastY) * 0.004));
        _orbit.lastX = e.clientX; _orbit.lastY = e.clientY;
        applyOrbit();
    });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        _orbit.radius = Math.max(55, Math.min(400, _orbit.radius * (1 + e.deltaY * 0.0012)));
        applyOrbit();
    }, { passive: false });
    canvas.style.cursor = 'grab';
    applyOrbit();
}
function applyOrbit() {
    const o = _orbit;
    camera.position.set(
        o.target.x + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
        o.target.y + o.radius * Math.cos(o.phi),
        o.target.z + o.radius * Math.sin(o.phi) * Math.sin(o.theta)
    );
    camera.lookAt(o.target);
}

// ============================================================
// 图表
// ============================================================
function initCharts() {
    Chart.defaults.color = '#9fb5cc';
    Chart.defaults.borderColor = '#243447';

    chartEnergyFlow = new Chart(document.getElementById('chart-energy-flow'), {
        type: 'bar',
        data: {
            labels: ['光伏', '电池充电', '电池放电', '电网', '电解槽', '碳捕获', 'CH₃OH合成'],
            datasets: [{
                data: [0, 0, 0, 0, 0, 0, 0],
                backgroundColor: ['#ffcc33', '#44ff66', '#ff8833', '#4488ff', '#2d8fdd', '#6a9f4a', '#d47b3a'],
                borderRadius: 4, borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#1e3348' } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });

    chart24h = new Chart(document.getElementById('chart-24h'), {
        type: 'line',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => i + 'h'),
            datasets: [
                { label: '太阳辐射 (kW)', data: Array(24).fill(0), borderColor: '#ffcc33', backgroundColor: 'rgba(255,204,51,0.12)', yAxisID: 'y', tension: 0.35, pointRadius: 0, fill: true },
                { label: '电价 ($/kWh)', data: Array(24).fill(0), borderColor: '#ff8833', yAxisID: 'y1', tension: 0.35, pointRadius: 0, borderDash: [5, 4] },
                { label: '电池 SOC (%)', data: Array(24).fill(0), borderColor: '#44ff66', yAxisID: 'y2', tension: 0.35, pointRadius: 0 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } },
            scales: {
                y: { position: 'left', grid: { color: '#1e3348' }, title: { display: true, text: 'kW' } },
                y1: { position: 'right', grid: { display: false }, min: 0, max: 0.2, ticks: { color: '#ff8833' } },
                y2: { position: 'right', grid: { display: false }, min: 0, max: 100, ticks: { color: '#44ff66' }, offset: true }
            }
        }
    });

    chartCumulative = new Chart(document.getElementById('chart-cumulative'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'CH₃OH (kg)', data: [], borderColor: '#d47b3a', backgroundColor: 'rgba(212,123,58,0.18)', tension: 0.3, fill: true, pointRadius: 0 },
                { label: 'H₂ (kg)', data: [], borderColor: '#2d8fdd', backgroundColor: 'rgba(45,143,221,0.14)', tension: 0.3, fill: true, pointRadius: 0 },
                { label: 'CO₂ (kg)', data: [], borderColor: '#6a9f4a', backgroundColor: 'rgba(106,159,74,0.14)', tension: 0.3, fill: true, pointRadius: 0 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#1e3348' } },
                x: { grid: { color: '#1e3348' }, ticks: { maxTicksLimit: 8, font: { size: 10 } } }
            }
        }
    });
}

function updateCharts(result) {
    chartEnergyFlow.data.datasets[0].data = [
        result.pv_output_kW || 0,
        result.battery_charge_kW,
        result.battery_discharge_kW,
        result.grid_to_load_kW,
        result.power_electrolyzer_kW,
        result.power_carbon_capture_kW,
        result.power_ch3oh_synthesis_kW
    ];
    chartEnergyFlow.update('none');

    const h = result.localHour;
    chart24h.data.datasets[0].data[h] = result.input_solar_forecast_kW;
    chart24h.data.datasets[1].data[h] = result.price_usd_per_kWh;
    chart24h.data.datasets[2].data[h] = result.battery_soc_percent;
    chart24h.update('none');

    chartCumulative.data.labels.push(result.hour + 'h');
    chartCumulative.data.datasets[0].data.push(result.cumulative_ch3oh_kg);
    chartCumulative.data.datasets[1].data.push(result.cumulative_h2_kg);
    chartCumulative.data.datasets[2].data.push(result.cumulative_co2_captured_kg);
    if (chartCumulative.data.labels.length > 240) {
        chartCumulative.data.labels.shift();
        chartCumulative.data.datasets.forEach(d => d.data.shift());
    }
    chartCumulative.update('none');
}

// ============================================================
// 右侧数据面板
// ============================================================
function el(id) { return document.getElementById(id); }

function updateDashboard(result, ecomp) {
    const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

    el('dash-hour').textContent = `t = ${result.hour}h  (本地 ${String(result.localHour).padStart(2, '0')}:00)`;
    el('dash-solar').textContent = fmt(result.input_solar_forecast_kW) + ' kW';
    el('dash-pv').textContent = fmt(result.pv_output_kW) + ' kW';
    el('dash-price').textContent = '$' + result.price_usd_per_kWh.toFixed(2) + '/kWh';

    el('dash-el').textContent = fmt(result.power_electrolyzer_kW) + ' kW';
    el('dash-cap').textContent = fmt(result.power_carbon_capture_kW) + ' kW';
    el('dash-ch3').textContent = fmt(result.power_ch3oh_synthesis_kW) + ' kW';

    el('dash-h2-now').textContent = fmt(result.h2_production_kg_per_h, 2) + ' kg/h';
    el('dash-co2-now').textContent = fmt(result.co2_captured_kg_per_h, 2) + ' kg/h';
    el('dash-ch3-now').textContent = fmt(result.ch3oh_production_kg_per_h, 2) + ' kg/h';

    const soc = result.battery_soc_percent;
    el('dash-soc').textContent = soc.toFixed(1) + '%';
    el('dash-soc-bar').style.width = soc + '%';
    el('dash-soc-bar').className = 'soc-bar-fill ' + (soc > 60 ? 'soc-high' : soc > 30 ? 'soc-mid' : 'soc-low');
    el('dash-soc-kwh').textContent = fmt(result.battery_soc_kWh) + ' kWh';
    if (result.battery_charge_kW > 100) el('dash-batt-mode').textContent = '⚡ 充电中';
    else if (result.battery_discharge_kW > 100) el('dash-batt-mode').textContent = '🔋 放电中';
    else el('dash-batt-mode').textContent = '— 待机 —';

    el('dash-h2-total').textContent = fmt(result.cumulative_h2_kg) + ' kg';
    el('dash-co2-total').textContent = fmt(result.cumulative_co2_captured_kg) + ' kg';
    el('dash-ch3-total').textContent = fmt(result.cumulative_ch3oh_kg) + ' kg';
    el('dash-grid-total').textContent = fmt(SIMULATION.STATE.cumulative_grid_kWh) + ' kWh';
    el('dash-cost-total').textContent = '$' + fmt(result.cumulative_cost_usd, 0);

    if (ecomp) {
        el('dash-lcoe').textContent = '$' + ecomp.cost_per_t_ch3oh_usd + ' /t CH₃OH';
        el('dash-cf').textContent = ecomp.carbon_footprint_kgCO2_per_tCH3OH + ' kgCO₂eq /t CH₃OH';
    }
}

// ============================================================
// 主循环
// ============================================================
function tickSimulation(fconfig, extra, lastEconomy) {
    const input = INPUT_DATA.nextHour();
    const result = SIMULATION.dispatchHour(input, fconfig, extra);
    updateThreeD(result, input);
    updateCharts(result);
    let ecomp = lastEconomy;
    if (result.hour % 6 === 0 || input.localHour === 23) {
        ecomp = SIMULATION.computeLCOHAndCarbonFootprint(fconfig, extra, result.hour + 1);
    }
    updateDashboard(result, ecomp);
    return ecomp;
}

function startSimulationLoop(fconfig, extra) {
    if (simTimer) clearInterval(simTimer);
    SIMULATION.resetSimulation(fconfig, extra);
    INPUT_DATA.resetInputCursor();

    chartCumulative.data.labels = [];
    chartCumulative.data.datasets.forEach(d => { d.data = []; });
    chart24h.data.datasets.forEach(d => { d.data = Array(24).fill(0); });
    chart24h.data.datasets[0].data = INPUT_DATA.SOLAR_CURVE.slice();
    chart24h.data.datasets[1].data = INPUT_DATA.PRICE_CURVE.slice();
    chart24h.update();
    chartCumulative.update();
    chartEnergyFlow.update();

    let ecomp = null;
    ecomp = tickSimulation(fconfig, extra, ecomp);
    simTimer = setInterval(() => { ecomp = tickSimulation(fconfig, extra, ecomp); }, simSpeed);
}

function pauseSimulation() { if (simTimer) { clearInterval(simTimer); simTimer = null; } }
function resumeSimulation(fconfig, extra) {
    if (simTimer) return;
    let ecomp = null;
    simTimer = setInterval(() => { ecomp = tickSimulation(fconfig, extra, ecomp); }, simSpeed);
}
function setSpeed(ms) {
    simSpeed = ms;
    if (simTimer) {
        clearInterval(simTimer);
        const f = window.CONFIG.fconfig, e = window.CONFIG.extra;
        let ecomp = null;
        simTimer = setInterval(() => { ecomp = tickSimulation(f, e, ecomp); }, simSpeed);
    }
}

if (typeof window !== 'undefined') {
    window.VIZ = {
        initThreeD, initCharts, updateThreeD, updateCharts, updateDashboard,
        startSimulationLoop, pauseSimulation, resumeSimulation, setSpeed
    };
}
