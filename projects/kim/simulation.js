// ============================================================
// simulation.js — 能源智能分配仿真引擎
// ============================================================

// 全局状态（仿真期间保持不变）
const STATE = {
    battery_kWh: 0,
    // 缓冲储备：已产出但尚未下游使用的 H2 和 CO2
    tank_H2_kg: 0,
    tank_CO2_kg: 0,
    cumulative_cost_$: 0,
    cumulative_grid_kWh: 0,
    cumulative_solar_kWh: 0,
    cumulative_charge_kWh: 0,
    cumulative_discharge_kWh: 0,
    cumulative_ch3oh_kg: 0,
    cumulative_h2_kg: 0,
    cumulative_co2_captured_kg: 0,
    history: []  // 每小时结果
};

// 化学计量比 & 设备能耗系数
// CH3OH = CO2 + 3 H2 → CH3OH + H2O
// MW: C=12, O=16, H=1   → CH3OH=32, CO2=44, H2=2*3=6
// 1 kg CH3OH ← 44/32=1.375 kg CO2 + 6/32=0.1875 kg H2
const STOICH = {
    CO2_per_CH3OH: 44 / 32,   // 1.375
    H2_per_CH3OH: 6 / 32      // 0.1875
};

function resetSimulation(fconfig, extra) {
    STATE.battery_kWh = fconfig.battery.battery_capacity * extra.battery.initial_soc;
    STATE.tank_H2_kg = 0;
    STATE.tank_CO2_kg = 0;
    STATE.cumulative_cost_$ = 0;
    STATE.cumulative_grid_kWh = 0;
    STATE.cumulative_solar_kWh = 0;
    STATE.cumulative_charge_kWh = 0;
    STATE.cumulative_discharge_kWh = 0;
    STATE.cumulative_ch3oh_kg = 0;
    STATE.cumulative_h2_kg = 0;
    STATE.cumulative_co2_captured_kg = 0;
    STATE.history = [];
    if (typeof window !== 'undefined' && window.INPUT_DATA) {
        window.INPUT_DATA.resetInputCursor();
    }
}

// 核心调度：给定一个时刻的输入，分配能量并计算产出
// input = { hour, localHour, solar, price }
// 假设电池容量 800,000 kWh，功率 8,000 kW
function dispatchHour(input, fconfig, extra) {
    const CAPACITY = fconfig.battery.battery_capacity;
    const P_BATT_RATE = fconfig.battery.power_rating;
    const ETA_C = extra.battery.charge_efficiency;   // 0.92
    const ETA_D = extra.battery.discharge_efficiency; // 0.92

    // 设备最大功率
    const P_EL_MAX = fconfig.electrolyzer.power_max;     // 4800 kW
    const P_CAP_MAX = fconfig['Carbon capture'].power_max; // 5000 kW
    const P_CH3_MAX = fconfig.CH3OH_production.power_max;  // 8000 kW
    const TOTAL_MAX_LOAD = P_EL_MAX + P_CAP_MAX + P_CH3_MAX; // 17800 kW

    const SOC_MIN = CAPACITY * extra.battery.min_soc; // 80000 kWh
    const SOC_MAX = CAPACITY * extra.battery.max_soc; // 760000 kWh

    // 决策：太阳能优先供负荷，再按峰谷电价决定电池充/放，最后电网补齐
    const radiation_kW = input.solar;   // 入射太阳辐射功率（kW）
    // 实际光伏发电 = 辐射 × 组件效率 × 逆变器效率
    const solar_in = radiation_kW * extra.solar.panel_efficiency * extra.solar.inverter_efficiency;
    let P_battery_charge = 0;    // kW（交流侧，电池吸收）
    let P_battery_discharge = 0; // kW（交流侧，电池放出）
    let P_grid = 0;
    let solar_to_load = 0;
    let solar_to_battery = 0;
    const price = input.price;   // $/kWh

    // 峰谷电价策略：谷段充电 / 峰段放电 / 平段不充不放
    const isValley = price <= 0.05;
    const isPeak = price >= 0.12;
    const currentSoc = STATE.battery_kWh / CAPACITY;
    const headroom_kWh = Math.max(0, SOC_MAX - STATE.battery_kWh);

    // 1) 太阳能先供负荷
    solar_to_load = Math.min(solar_in, TOTAL_MAX_LOAD);
    let solar_surplus = solar_in - solar_to_load;

    // 电网接入容量：负荷优先，剩余容量才用于充电
    const GRID_CAP = extra.grid.grid_connection_limit_kW;
    const load_need = Math.max(0, TOTAL_MAX_LOAD - solar_to_load);
    const grid_for_load = Math.min(load_need, GRID_CAP);
    const grid_headroom = Math.max(0, GRID_CAP - grid_for_load);

    if (isValley && currentSoc < extra.battery.max_soc) {
        // 谷段：把电池充满（优先富余太阳能，其余买谷电）
        const charge_cap_ac = Math.min(P_BATT_RATE, headroom_kWh / ETA_C);
        solar_to_battery = Math.min(solar_surplus, charge_cap_ac);
        const charge_from_grid = Math.min(charge_cap_ac - solar_to_battery, grid_headroom);
        P_battery_charge = solar_to_battery + charge_from_grid;
        P_grid = grid_for_load + charge_from_grid;
    } else if (isPeak && currentSoc > extra.battery.min_soc) {
        // 峰段：缺口由电池放电顶上，尽量少买贵电
        const max_by_soc = (STATE.battery_kWh - SOC_MIN) * ETA_D;
        P_battery_discharge = Math.min(load_need, P_BATT_RATE, max_by_soc);
        P_grid = Math.min(Math.max(0, load_need - P_battery_discharge), GRID_CAP);
    } else {
        // 平段：缺口由电网补，富余给电池充电
        if (solar_surplus > 0) {
            solar_to_battery = Math.min(solar_surplus, P_BATT_RATE, headroom_kWh / ETA_C);
        }
        P_battery_charge = solar_to_battery;
        P_grid = grid_for_load;
    }

    // 实际可供负荷的功率（充电功率不参与负荷分配）
    const avail_power = Math.max(0, solar_to_load + P_battery_discharge + P_grid);
    const scale = Math.min(1, avail_power / TOTAL_MAX_LOAD);

    const P_el = P_EL_MAX * scale;
    const P_cap = P_CAP_MAX * scale;
    const P_ch3 = P_CH3_MAX * scale;

    // 第四步：计算产出（clamp 到 fconfig 设计产能上限）
    // 电解槽：4800 kW → 100 kg H2/h (匹配 fconfig: power_max=4800, rate=100)
    const eta_H2 = extra.electrolyzer.specific_energy_consumption_kWh_per_kg_H2;
    const H2_design_cap = fconfig.electrolyzer.hygrogen_production_rate; // 100
    const H2_produced = Math.min(P_el / eta_H2, H2_design_cap); // kg/h

    // 碳捕获：5000 kW → 726 kg CO2/h
    const eta_CO2 = extra.carbon_capture.specific_energy_consumption_kWh_per_kg_CO2;
    const CO2_design_cap = fconfig['Carbon capture'].carbon_capture_rate; // 726
    const CO2_captured = Math.min(P_cap / eta_CO2, CO2_design_cap); // kg/h

    // 更新缓冲罐
    STATE.tank_H2_kg += H2_produced;
    STATE.tank_CO2_kg += CO2_captured;

    // 第四步：CH3OH合成 —— 三重约束（化学计量 + 原料储罐 + 能量）
    const CH3OH_design_cap = fconfig.CH3OH_production.CH3OH_production_rate; // 528
    const max_by_CO2 = STATE.tank_CO2_kg / STOICH.CO2_per_CH3OH; // kg CH3OH 可由罐中 CO2 合成
    const max_by_H2  = STATE.tank_H2_kg  / STOICH.H2_per_CH3OH;
    const max_by_energy = P_ch3 / extra.CH3OH_production.specific_energy_consumption_kWh_per_kg_CH3OH;
    const CH3OH_rate = Math.min(CH3OH_design_cap, max_by_CO2, max_by_H2, max_by_energy);

    const CO2_consumed = CH3OH_rate * STOICH.CO2_per_CH3OH;
    const H2_consumed = CH3OH_rate * STOICH.H2_per_CH3OH;
    STATE.tank_CO2_kg = Math.max(0, STATE.tank_CO2_kg - CO2_consumed);
    STATE.tank_H2_kg = Math.max(0, STATE.tank_H2_kg - H2_consumed);

    // 第六步：更新电池状态（充/放电均按效率折算）
    STATE.battery_kWh += P_battery_charge * ETA_C - P_battery_discharge / ETA_D;
    STATE.battery_kWh = Math.max(SOC_MIN, Math.min(SOC_MAX, STATE.battery_kWh));

    // 第七步：累计成本 / 产出
    const grid_energy = P_grid; // kWh 本小时
    const solar_energy = solar_to_load + solar_to_battery;
    const charge_energy = P_battery_charge;
    const discharge_energy = P_battery_discharge;

    STATE.cumulative_cost_$ += grid_energy * price;
    STATE.cumulative_grid_kWh += grid_energy;
    STATE.cumulative_solar_kWh += solar_energy;
    STATE.cumulative_charge_kWh += charge_energy;
    STATE.cumulative_discharge_kWh += discharge_energy;
    STATE.cumulative_ch3oh_kg += CH3OH_rate;
    STATE.cumulative_h2_kg += H2_produced;
    STATE.cumulative_co2_captured_kg += CO2_captured;

    const result = {
        hour: input.hour,
        localHour: input.localHour,
        input_solar_forecast_kW: input.solar,
        pv_output_kW: solar_in,
        price_usd_per_kWh: input.price,

        // 能量分配
        solar_to_load_kW: solar_to_load,
        solar_to_battery_kW: solar_to_battery,
        battery_charge_kW: P_battery_charge,
        battery_discharge_kW: P_battery_discharge,
        grid_to_load_kW: grid_energy,
        battery_soc_kWh: STATE.battery_kWh,
        battery_soc_percent: (STATE.battery_kWh / CAPACITY) * 100,

        // 各设备功率
        power_electrolyzer_kW: P_el,
        power_carbon_capture_kW: P_cap,
        power_ch3oh_synthesis_kW: P_ch3,

        // 产出（kg/h）
        h2_production_kg_per_h: H2_produced,
        co2_captured_kg_per_h: CO2_captured,
        ch3oh_production_kg_per_h: CH3OH_rate,
        tank_H2_kg: STATE.tank_H2_kg,
        tank_CO2_kg: STATE.tank_CO2_kg,

        // 累计
        cumulative_cost_usd: STATE.cumulative_cost_$,
        cumulative_ch3oh_kg: STATE.cumulative_ch3oh_kg,
        cumulative_h2_kg: STATE.cumulative_h2_kg,
        cumulative_co2_captured_kg: STATE.cumulative_co2_captured_kg
    };

    STATE.history.push(result);
    return result;
}

// ============================================================
// 经济 & 碳足迹计算（运行一整天或更长时间后调用）
// ============================================================

function computeLCOHAndCarbonFootprint(fconfig, extra, horizon_hours = 24) {
    const total_hours = Math.max(1, horizon_hours);
    // Capex
    const total_capex = Object.values(fconfig).reduce((s, eq) => s + (eq.equipment_cost || 0), 0);
    // Annualized Capex using CRF
    const r = extra.economic.annual_interest_rate;
    const n = extra.economic.equipment_lifetime_years;
    const CRF = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const annualized_capex = total_capex * CRF;
    const annual_hours = 365 * 24;

    const capex_per_kWh_el_in = annualized_capex / (annual_hours * (fconfig.electrolyzer.power_max + fconfig['Carbon capture'].power_max + fconfig.CH3OH_production.power_max) / 2);
    // 更简化：直接按运行时长分摊
    const hourly_fixed_cost = annualized_capex / annual_hours; // $/h 固定成本

    // 运维 + 人工（来自 extra.json 的 marginal_cost）
    const hourly_maintenance = total_capex * extra.marginal_cost.maintenance_percent_of_capex_per_year / annual_hours;
    const hourly_labor = extra.marginal_cost.labor_cost_per_hour * extra.marginal_cost.operator_count;
    const hourly_non_energy_cost = hourly_fixed_cost + hourly_maintenance + hourly_labor;

    // 运行 horizon_hours 的累计数值
    const hist = STATE.history.slice(-horizon_hours);
    const total_cost_opex = STATE.cumulative_cost_$;
    const total_ch3oh_tons = STATE.cumulative_ch3oh_kg / 1000;
    const total_grid_kWh = STATE.cumulative_grid_kWh;
    const total_solar_kWh = STATE.cumulative_solar_kWh;

    // 每吨 CH3OH 成本 = (电费 + 固定成本 + 运维 + 人工) / 产量
    let cost_per_t_ch3oh = total_ch3oh_tons > 0
        ? (total_cost_opex + STATE.history.length * hourly_non_energy_cost) / total_ch3oh_tons
        : 0;

    // 碳足迹：电网电 * 电网碳强度 + 太阳能的隐含碳（可以忽略或估）
    const grid_CO2 = total_grid_kWh * extra.grid.carbon_intensity_kgCO2_per_kWh;
    const total_ch3oh_produced = STATE.cumulative_ch3oh_kg;
    let carbon_footprint_kgCO2_per_tCH3OH = total_ch3oh_produced > 0 ? (grid_CO2 / total_ch3oh_produced) * 1000 : 0;

    // 碳捕获是负排放（假设捕获的是工业排放），但 CH3OH 合成又会释放 CO2
    // 简化：CH3OH碳足迹 = 电网电碳排放 / CH3OH产量(吨)
    // 实际工业中 CH3OH 燃烧释放 CO2 等于生产中消耗的 CO2，所以净为零

    return {
        hourly_fixed_cost_usd: hourly_fixed_cost,
        total_capex_usd: total_capex,
        annualized_capex_usd: annualized_capex,
        horizon_hours: total_hours,
        operating_cost_usd: total_cost_opex,
        total_ch3oh_kg: STATE.cumulative_ch3oh_kg,
        cost_per_t_ch3oh_usd: Math.round(cost_per_t_ch3oh * 100) / 100,
        grid_kWh: total_grid_kWh,
        solar_kWh: total_solar_kWh,
        grid_co2_kg: grid_CO2,
        carbon_footprint_kgCO2_per_tCH3OH: Math.round(carbon_footprint_kgCO2_per_tCH3OH * 100) / 100
    };
}

if (typeof window !== 'undefined') {
    window.SIMULATION = {
        STATE, STOICH, resetSimulation, dispatchHour, computeLCOHAndCarbonFootprint
    };
}
