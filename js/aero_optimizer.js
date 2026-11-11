/**
 * トビウオ天秤＆各種オモリ用 航空力学・自動伸縮テール＆最適尾翼計算エンジン
 * TobiuoMaker Aero & Tail Optimization Engine
 */

(function(exports) {
    "use strict";

    /**
     * 重りパラメータ、迎角、テール長から、最適な主翼・水平尾翼・垂直尾翼および空力性能を算出
     */
    function calculateOptimalGlider(input) {
        const sinkerType = input.sinker_type || "bullet";
        const weightG = parseFloat(input.weight_g) || 14.0;
        const diameterMm = parseFloat(input.diameter_mm) || 10.0;
        const lengthMm = parseFloat(input.length_mm) || 22.0;
        const aoaDeg = parseFloat(input.angle_of_attack_deg) !== undefined ? parseFloat(input.angle_of_attack_deg) : 3.0;
        const glideMode = input.glide_mode || "air";
        const flightSpeed = parseFloat(input.flight_speed_ms) || 18.0;

        // 物理定数
        const rho = (glideMode === "water") ? 1025.0 : 1.225; // kg/m3
        const gAcc = 9.80665;
        const leadDensity = 11.34; // g/cm3

        // 実効重量 (N)
        let effectiveMassG = weightG;
        let speed = flightSpeed;
        if (glideMode === "water") {
            const buoyancyFactor = 1.0 - (1.025 / leadDensity);
            effectiveMassG = weightG * buoyancyFactor;
            speed = Math.min(speed, 2.5); // 水中代表速度
        }
        const weightN = (effectiveMassG / 1000.0) * gAcc;

        // オモリ本体の抗力係数 Cd_body
        const cdBodyMap = {
            bullet: 0.28,
            king_tenbin: 0.36,
            drop: 0.44,
            cylinder: 0.72,
            custom: 0.35
        };
        const cdBody = cdBodyMap[sinkerType] || 0.35;
        const bodyRadiusM = (diameterMm / 2.0) / 1000.0;
        const bodyFrontalAreaM2 = Math.PI * (bodyRadiusM * bodyRadiusM);

        // 主翼（ジュデルスキー高揚力翼型）の空力特性
        const alpha0Deg = -3.5; // ゼロ揚力迎角 (キャンバーによる底上げ)
        const clSlope = 0.095;  // 揚力傾斜 (/deg)
        const stallAngleDeg = 13.5;
        const isStalled = (aoaDeg > stallAngleDeg);

        let clWing = 0.0;
        if (aoaDeg <= stallAngleDeg) {
            clWing = clSlope * (aoaDeg - alpha0Deg);
        } else {
            const clPeak = clSlope * (stallAngleDeg - alpha0Deg);
            const excess = aoaDeg - stallAngleDeg;
            clWing = Math.max(0.2, clPeak * Math.exp(-0.16 * excess));
        }
        clWing = Math.max(0.05, clWing);

        // 主翼設計 (アスペクト比 AR_w = 3.6)
        const targetAR = 3.6;
        const oswaldE = 0.85;

        // 必要揚力バランス: 全重の30%〜45%を主翼で負担
        const targetLiftRatio = (glideMode === "air") ? 0.36 : 0.50;
        const targetLiftN = weightN * targetLiftRatio;
        const dynPressure = 0.5 * rho * (speed * speed);

        let neededAreaM2 = targetLiftN / (dynPressure * clWing);
        let neededAreaMm2 = Math.max(700.0, Math.min(5000.0, neededAreaM2 * 1e6));

        // 最適スパン・コード
        let optSpanMm = Math.sqrt(neededAreaMm2 * targetAR);
        let optMeanChordMm = optSpanMm / targetAR;

        // ユーザー手動指定があれば優先
        const spanMm = (input.span_mm && input.span_mm > 0) ? parseFloat(input.span_mm) : optSpanMm;
        const meanChordMm = (input.mean_chord_mm && input.mean_chord_mm > 0) ? parseFloat(input.mean_chord_mm) : optMeanChordMm;

        const rootChordMm = meanChordMm * 1.12;
        const tipChordMm = meanChordMm * 0.88;
        const actualAreaMm2 = spanMm * meanChordMm;
        const actualAreaM2 = actualAreaMm2 * 1e-6;
        const actualAR = (spanMm * spanMm) / actualAreaMm2;

        // ============================================================
        // 🌟 テール自動伸縮＆水平・垂直尾翼の厳密連動設計
        // ============================================================
        // オモリの質量・全長・主翼コードに応じた最適テールアーム長 lt_opt (mm)
        // 重いオモリ（慣性大）ほど、ピッチ・ヨーを抑えるためにアームを長く取る
        const weightFactor = Math.min(1.5, Math.max(0.6, weightG / 20.0));
        let optTailArmLengthMm = (meanChordMm * 2.2 * Math.sqrt(weightFactor)) + (lengthMm * 0.5) + 10.0;
        
        // 種類に応じた調整（キング天秤は元々ワイヤーが長い）
        if (sinkerType === "king_tenbin") {
            optTailArmLengthMm = Math.max(optTailArmLengthMm, 65.0);
        } else {
            optTailArmLengthMm = Math.max(35.0, Math.min(120.0, optTailArmLengthMm));
        }

        // ユーザー手動テール長スライダーがあればそれを採用
        const tailArmLengthMm = (input.tail_length_mm && input.tail_length_mm > 0) 
            ? parseFloat(input.tail_length_mm) 
            : optTailArmLengthMm;

        // 1. 水平尾翼 (Horizontal Stabilizer) の連動計算
        // 目標水平尾翼容積比 V_H = (S_H * lt) / (S * c_mean) ≈ 0.44
        const targetVH = 0.44;
        // S_H (mm2) = (V_H * S * c_mean) / lt
        const horizTailAreaMm2 = Math.max(120.0, (targetVH * actualAreaMm2 * meanChordMm) / Math.max(15.0, tailArmLengthMm));
        const horizAR = 3.2; // 水平尾翼アスペクト比
        const horizSpanMm = Math.sqrt(horizTailAreaMm2 * horizAR);
        const horizChordMm = horizTailAreaMm2 / horizSpanMm;
        const horizTrimAngleDeg = -2.0; // 主翼頭下げモーメントを打ち消すデカラージュ角

        // 2. 垂直尾翼 (Vertical Stabilizer) の連動計算
        // 目標垂直尾翼容積比 V_V = (S_V * lt) / (S * b) ≈ 0.040
        const targetVV = 0.040;
        // S_V (mm2) = (V_V * S * b) / lt
        const vertTailAreaMm2 = Math.max(80.0, (targetVV * actualAreaMm2 * spanMm) / Math.max(15.0, tailArmLengthMm));
        const vertAR = 1.35; // 垂直尾翼アスペクト比
        const vertHeightMm = Math.sqrt(vertTailAreaMm2 * vertAR);
        const vertChordMm = vertTailAreaMm2 / vertHeightMm;

        // 静的縦安定余裕度 (Static Margin: SM) の算出
        // 重心 X_cg (オモリ位置): 主翼前縁から約 0.20 * c_mean
        // 中立点 X_np = X_ac + lt * (a_H / a_w) * (1 - de/da) * (S_H / S)
        const xCg = meanChordMm * 0.20;
        const xAc = meanChordMm * 0.25;
        const downwashFactor = 1.0 - (2.0 * clSlope * 57.3) / (Math.PI * actualAR);
        const tailLiftRatio = (0.075 / clSlope) * Math.max(0.4, downwashFactor) * (horizTailAreaMm2 / actualAreaMm2);
        const xNp = xAc + (tailArmLengthMm * tailLiftRatio);
        const staticMargin = ((xNp - xCg) / meanChordMm) * 100.0; // %

        let stabilityDesc = "";
        if (staticMargin >= 5.0 && staticMargin <= 20.0) {
            stabilityDesc = `縦安定性: 極めて良好 (静的余裕度 ${staticMargin.toFixed(1)}%)。復元力と滑空比が最適バランス！`;
        } else if (staticMargin > 20.0) {
            stabilityDesc = `縦安定性: 過安定 (静的余裕度 ${staticMargin.toFixed(1)}%)。頭下げ傾向がやや強いため、テールを縮めるか水平尾翼を微調整してください。`;
        } else {
            stabilityDesc = `縦安定性: 不足 (静的余裕度 ${staticMargin.toFixed(1)}%)。テール長を伸ばして尾翼容積を稼いでください。`;
        }

        // 空力係数と力の計算
        const cdInduced = (clWing * clWing) / (Math.PI * oswaldE * actualAR);
        const cdProfileWing = 0.022 + (isStalled ? 0.16 : 0.0);
        const cdTails = (0.015 * horizTailAreaMm2 + 0.015 * vertTailAreaMm2) / actualAreaMm2;
        const cdBodyRef = cdBody * (bodyFrontalAreaM2 / actualAreaM2);
        const totalCd = cdProfileWing + cdInduced + cdTails + cdBodyRef;

        const liftN = dynPressure * actualAreaM2 * clWing;
        const dragN = dynPressure * actualAreaM2 * totalCd;
        const liftG = (liftN / gAcc) * 1000.0;
        const dragG = (dragN / gAcc) * 1000.0;
        const liftDragRatio = liftN / Math.max(0.001, dragN);
        const glideAngleDeg = Math.atan2(dragN, Math.max(0.001, liftN)) * (180.0 / Math.PI);

        // 推定飛距離増加シミュレーション
        let distanceFactor = 1.0;
        if (isStalled) {
            distanceFactor = 0.82;
        } else if (aoaDeg >= 2.0 && aoaDeg <= 5.0) {
            distanceFactor = 1.0 + Math.min(0.38, (liftDragRatio / 6.0) * 0.30);
        } else {
            distanceFactor = 1.08;
        }
        const estimatedDistanceM = 75.0 * distanceFactor;

        return {
            sinker_type: sinkerType,
            weight_g: weightG,
            diameter_mm: diameterMm,
            length_mm: lengthMm,
            angle_of_attack_deg: aoaDeg,
            glide_mode: glideMode,
            flight_speed_ms: speed,
            // 主翼寸法
            span_mm: Math.round(spanMm * 10) / 10,
            root_chord_mm: Math.round(rootChordMm * 10) / 10,
            tip_chord_mm: Math.round(tipChordMm * 10) / 10,
            mean_chord_mm: Math.round(meanChordMm * 10) / 10,
            area_cm2: Math.round((actualAreaMm2 / 100.0) * 10) / 10,
            aspect_ratio: Math.round(actualAR * 100) / 100,
            sweep_back_deg: 8.0,
            dihedral_deg: -3.5,
            wing_thickness_mm: 2.0,
            // 🌟 連動テール＆尾翼寸法
            tail_length_mm: Math.round(tailArmLengthMm * 10) / 10,
            tail_type: input.tail_type || "cruciform", // cruciform (十字) / box (ボックス)
            horiz_tail_area_mm2: Math.round(horizTailAreaMm2 * 10) / 10,
            horiz_span_mm: Math.round(horizSpanMm * 10) / 10,
            horiz_chord_mm: Math.round(horizChordMm * 10) / 10,
            horiz_trim_deg: horizTrimAngleDeg,
            vert_tail_area_mm2: Math.round(vertTailAreaMm2 * 10) / 10,
            fin_height_mm: Math.round(vertHeightMm * 10) / 10,
            fin_chord_mm: Math.round(vertChordMm * 10) / 10,
            // 安定性＆空力
            static_margin_pct: Math.round(staticMargin * 10) / 10,
            stability_description: stabilityDesc,
            cl: Math.round(clWing * 1000) / 1000,
            cd: Math.round(totalCd * 1000) / 1000,
            lift_g: Math.round(liftG * 10) / 10,
            drag_g: Math.round(dragG * 10) / 10,
            lift_drag_ratio: Math.round(liftDragRatio * 100) / 100,
            glide_angle_deg: Math.round(glideAngleDeg * 10) / 10,
            estimated_distance_m: Math.round(estimatedDistanceM * 10) / 10,
            is_stalled: isStalled
        };
    }

    exports.calculateOptimalGlider = calculateOptimalGlider;

})(typeof exports === 'undefined' ? (this.AeroOptimizer = {}) : exports);
