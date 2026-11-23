// ============================================================
// input_data.js — 生成24小时太阳辐射功率 & 电价
// ============================================================

// 基于典型晴朗日 + 轻微云量扰动的太阳能发电曲线
// 太阳能板面积: 10000 m², 板效率 20%, 逆变器 96%, 温度修正 ~ -2%
// 峰值辐照度 ~800 W/m² (带云量损失), 所以峰值功率 ≈ 10000*800*0.2*0.96*0.98 ≈ 15000 kW
const SOLAR_CURVE = [
    0,     0,     0,     0,     0,
    0,
    120,   // 06:00 日出
    680,
    1850,
    3400,
    5200,
    7000,
    8600,  // 12:00 午间
    9400,  // 13:00 峰值
    9100,
    8200,
    6700,
    4900,
    3100,
    1500,
    400,
    50,    // 21:00 日落
    0,     0,     0
];

// 典型分时电价（$/kWh）
// 谷段: 0-6, 22-24   $0.04
// 平段: 7-8, 11-18   $0.08
// 峰段: 9-10, 19-21  $0.15
const PRICE_CURVE = [
    0.04, 0.04, 0.04, 0.04, 0.04, 0.04,
    0.04, // 06 谷段结束
    0.08, // 07 平段
    0.08, // 08 平段
    0.15, // 09 峰段
    0.15, // 10 峰段
    0.08, // 11 平段
    0.08,
    0.08,
    0.08,
    0.08,
    0.08,
    0.08,
    0.08,
    0.15, // 19 峰段
    0.15, // 20 峰段
    0.15, // 21 峰段
    0.04, // 22 谷段
    0.04
];

function round2(x) { return Math.round(x * 100) / 100; }

function round3(x) { return Math.round(x * 1000) / 1000; }

// 模拟多天（可循环使用）
function generateDailyInput(dayOffset = 0) {
    // 加入小扰动，让每天略有不同
    const solar = SOLAR_CURVE.map((v, t) => {
        const noise = 1 + 0.08 * Math.sin(t * 0.7 + dayOffset) - 0.05 * Math.abs(Math.sin(t * 0.3 + dayOffset * 0.5));
        return Math.max(0, Math.round(v * noise));
    });
    const price = PRICE_CURVE.map(v => round2(v * (1 + 0.03 * Math.sin(dayOffset))));
    return { solar, price };
}

// 当前正在仿真的小时索引（0-23），可被 visualization 推进
// 从清晨 06:00 开始，便于直观看到光伏起效的过程
let currentHour = 6;

function resetInputCursor() { currentHour = 6; }
function nextHour() {
    const dayOffset = Math.floor(currentHour / 24);
    const { solar, price } = generateDailyInput(dayOffset);
    const h = currentHour % 24;
    const result = { hour: currentHour, localHour: h, solar: solar[h], price: price[h] };
    currentHour++;
    return result;
}
function getCurrentHourIndex() { return currentHour % 24; }

// 立即执行并暴露到 window（浏览器模式）
if (typeof window !== 'undefined') {
    window.INPUT_DATA = {
        generateDailyInput,
        resetInputCursor,
        nextHour,
        getCurrentHourIndex,
        loadInputFiles,
        SOLAR_CURVE,
        PRICE_CURVE
    };
}

// 从 CSV 读取 24h 太阳辐射 / 电价（失败时保留内置曲线）
async function loadInputFiles() {
    try {
        const [solarTxt, priceTxt] = await Promise.all([
            fetch('solar_radiation.csv?v=1').then(r => r.text()),
            fetch('electricity_price.csv?v=1').then(r => r.text())
        ]);
        const parse = (txt) => txt.trim().split(/\r?\n/).slice(1)
            .map(line => line.split(','))
            .map(cols => Number(cols[1]))
            .filter(v => !Number.isNaN(v));
        const solar = parse(solarTxt);
        const price = parse(priceTxt);
        if (solar.length === 24) SOLAR_CURVE.splice(0, 24, ...solar);
        if (price.length === 24) PRICE_CURVE.splice(0, 24, ...price);
        return true;
    } catch (e) {
        console.warn('输入 CSV 读取失败，使用内置曲线', e);
        return false;
    }
}
