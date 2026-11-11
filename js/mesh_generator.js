/**
 * トビウオ天秤＆各種オモリ用 3Dパラメトリックメッシュ＆水密STL生成エンジン
 * TobiuoMaker Parametric 3D Mesh Generator
 */

(function(exports) {
    "use strict";

    // ジュデルスキー風キャンバー翼型の2D断面座標
    function generateJedelskyAirfoil(chord, thickness, numPoints) {
        numPoints = numPoints || 20;
        const s = [];
        for (let i = 0; i < numPoints; i++) {
            s.push(i / (numPoints - 1));
        }

        const camberMax = 0.065 * chord;
        const yLower = [];
        const zLower = [];
        const yUpper = [];
        const zUpper = [];

        for (let i = 0; i < numPoints; i++) {
            const si = s[i];
            const camber = 4.0 * camberMax * si * (1.0 - si) * (1.0 - 0.2 * si);
            const tDist = Math.max(1.0, thickness * (0.85 * Math.sqrt(si + 1e-4) * (1.0 - 0.5 * si) + 0.15 * (1.0 - si)));
            
            yLower.push(si * chord);
            zLower.push(camber - 0.5 * tDist);

            yUpper.push(si * chord);
            zUpper.push(camber + 0.5 * tDist);
        }

        // 下面: 前縁 -> 後縁, 上面: 後縁 -> 前縁
        const yProf = [];
        const zProf = [];
        for (let i = 0; i < numPoints; i++) {
            yProf.push(yLower[i]);
            zProf.push(zLower[i]);
        }
        for (let i = numPoints - 1; i >= 0; i--) {
            yProf.push(yUpper[i]);
            zProf.push(zUpper[i]);
        }

        return { y: yProf, z: zProf };
    }

    /**
     * グライダー全機体（主翼 + オモリ保持クランプ + 伸縮ブーム + 水平尾翼 + 垂直尾翼）の3D三角形メッシュを生成
     */
    function buildFullGliderMesh(params) {
        const triangles = []; // array of [ [x,y,z], [x,y,z], [x,y,z] ]
        const vertColors = []; // array of [ [r,g,b], [r,g,b], [r,g,b] ]

        const sinkerType = params.sinker_type || "bullet";
        const dia = parseFloat(params.diameter_mm) || 10.0;
        const length = parseFloat(params.length_mm) || 22.0;
        const aoaDeg = parseFloat(params.angle_of_attack_deg) || 3.0;
        const aoaRad = (aoaDeg * Math.PI) / 180.0;

        const span = parseFloat(params.span_mm) || 55.0;
        const rootChord = parseFloat(params.root_chord_mm) || 18.0;
        const tipChord = parseFloat(params.tip_chord_mm) || 14.0;
        const sweepDeg = parseFloat(params.sweep_back_deg) || 8.0;
        const dihedralDeg = parseFloat(params.dihedral_deg) || -3.5;
        const wingThick = parseFloat(params.wing_thickness_mm) || 2.0;

        // 連動テール＆尾翼パラメータ
        const tailLength = parseFloat(params.tail_length_mm) || 50.0;
        const horizSpan = parseFloat(params.horiz_span_mm) || 26.0;
        const horizChord = parseFloat(params.horiz_chord_mm) || 10.0;
        const horizTrimDeg = parseFloat(params.horiz_trim_deg) || -2.0;
        const horizTrimRad = (horizTrimDeg * Math.PI) / 180.0;

        const finHeight = parseFloat(params.fin_height_mm) || 14.0;
        const finChord = parseFloat(params.fin_chord_mm) || 10.0;

        // クランプ寸法
        const rIn = (dia / 2.0) + 0.28; // クリアランス
        const clampWall = 1.7; // 十分な肉厚
        const rOut = rIn + clampWall;
        const clampLen = Math.min(length * 0.90, Math.max(14.0, length * 0.75));
        const zCenter = -rOut * 0.35;

        // 座標系 (Three.js標準マッピングを念頭に):
        // X: 左右スパン (-span/2 〜 +span/2)
        // Y: 上下 (+Y: 垂直尾翼、-Y: 下面)
        // Z: 前後 (-Z: 機首前方、+Z: 後方テール)

        // ヘルパー: 三角形とカラーを追加
        function addTri(p1, p2, p3, c1, c2, c3) {
            triangles.push([p1, p2, p3]);
            vertColors.push([c1, c2, c3]);
        }

        // ==============================================================
        // 1. 主翼 (Main Wing) - 左右フィレット補強＆ジュデルスキー翼型
        // ==============================================================
        const numSpanSections = 14;
        const numAirfoilPts = 18;
        const semiSpan = span / 2.0;
        const halfClampW = Math.max(rOut * 0.85, 4.5);

        function getWingSection(xPos) {
            const eta = Math.max(0.0, Math.min(1.0, (Math.abs(xPos) - halfClampW) / Math.max(1.0, semiSpan - halfClampW)));
            const localChord = rootChord * (1.0 - eta) + tipChord * eta;
            
            // フィレット補強: 翼根(eta < 0.2)の肉厚とコード長を滑らかに増大
            let filletFactor = 1.0;
            if (eta < 0.25) {
                filletFactor = 1.0 + 0.45 * Math.pow(1.0 - (eta / 0.25), 2);
            }
            const localThick = wingThick * filletFactor * (1.0 - 0.2 * eta);

            // 後退角 (後方 +Z)
            const zSweep = Math.abs(xPos) * Math.tan((sweepDeg * Math.PI) / 180.0);
            // 下反角 (下方 -Y)
            const yDihedral = Math.abs(xPos) * Math.tan((dihedralDeg * Math.PI) / 180.0);

            const prof = generateJedelskyAirfoil(localChord, localThick, numAirfoilPts);

            // 迎角 (前縁が上がり、後縁が下がる回転)
            // Z軸正が後方、Y軸正が上方
            const cosA = Math.cos(aoaRad);
            const sinA = Math.sin(aoaRad);

            const pts = [];
            const cols = [];
            const numTotal = prof.y.length;
            for (let i = 0; i < numTotal; i++) {
                // prof.y は前縁(0)から後縁(chord)
                const localZ = prof.y[i];
                const localY = prof.z[i];

                const zRot = localZ * cosA - localY * sinA + zSweep;
                const yRot = localZ * sinA + localY * cosA + yDihedral;

                pts.push([xPos, yRot, zRot]);

                // 圧力カラーマップ: 上面(前半)は負圧(青〜シアン), 下面は正圧(赤〜橙)
                const isUpper = (i >= numAirfoilPts);
                if (isUpper) {
                    cols.push([0.15, 0.75, 1.0]); // 負圧 (吸引揚力)
                } else {
                    cols.push([1.0, 0.40, 0.15]); // 正圧 (押し上げ)
                }
            }
            return { pts: pts, cols: cols };
        }

        const xStations = [];
        for (let i = 0; i < numSpanSections; i++) {
            xStations.push(halfClampW + (semiSpan - halfClampW) * (i / (numSpanSections - 1)));
        }

        const secRight = xStations.map(x => getWingSection(x));
        const secLeft = xStations.map(x => getWingSection(-x));

        function loftSections(secList, flip) {
            const nRings = secList.length;
            const nPts = secList[0].pts.length;
            for (let i = 0; i < nRings - 1; i++) {
                const r1 = secList[i].pts;
                const r2 = secList[i+1].pts;
                const c1 = secList[i].cols;
                const c2 = secList[i+1].cols;
                for (let j = 0; j < nPts; j++) {
                    const jNext = (j + 1) % nPts;
                    const p1 = r1[j], p2 = r1[jNext], p3 = r2[jNext], p4 = r2[j];
                    const col1 = c1[j], col2 = c1[jNext], col3 = c2[jNext], col4 = c2[j];
                    if (!flip) {
                        addTri(p1, p2, p3, col1, col2, col3);
                        addTri(p1, p3, p4, col1, col3, col4);
                    } else {
                        addTri(p1, p3, p2, col1, col3, col2);
                        addTri(p1, p4, p3, col1, col4, col3);
                    }
                }
            }
        }

        loftSections(secRight, false);
        loftSections(secLeft, true);

        // 翼端キャップ
        function capSection(sec, flip) {
            const pts = sec.pts;
            const cols = sec.cols;
            const cPt = [0, 0, 0];
            for (let p of pts) { cPt[0] += p[0]; cPt[1] += p[1]; cPt[2] += p[2]; }
            cPt[0] /= pts.length; cPt[1] /= pts.length; cPt[2] /= pts.length;
            const cCol = [0.2, 0.8, 0.9];
            for (let j = 0; j < pts.length; j++) {
                const jNext = (j + 1) % pts.length;
                if (!flip) {
                    addTri(cPt, pts[j], pts[jNext], cCol, cols[j], cols[jNext]);
                } else {
                    addTri(cPt, pts[jNext], pts[j], cCol, cols[jNext], cols[j]);
                }
            }
        }
        capSection(secRight[numSpanSections - 1], false);
        capSection(secLeft[numSpanSections - 1], true);

        // 翼中央ブリッジ (左右ルート接続)
        const rRoot = secRight[0].pts;
        const lRoot = secLeft[0].pts;
        for (let j = 0; j < rRoot.length; j++) {
            const jNext = (j + 1) % rRoot.length;
            addTri(rRoot[j], lRoot[jNext], rRoot[jNext], [0.2,0.7,0.9], [0.2,0.7,0.9], [0.2,0.7,0.9]);
            addTri(rRoot[j], lRoot[j], lRoot[jNext], [0.2,0.7,0.9], [0.2,0.7,0.9], [0.2,0.7,0.9]);
        }

        // ==============================================================
        // 2. オモリ保持クランプ＆ラインガイドスリット＆脱落防止爪
        // ==============================================================
        const numCirc = 16;
        const numLen = 8;
        const phiStart = (45.0 * Math.PI) / 180.0;
        const phiEnd = (315.0 * Math.PI) / 180.0;
        
        const zClampStart = -clampLen * 0.45;
        const zClampEnd = clampLen * 0.55;

        const outerRings = [];
        const innerRings = [];

        for (let i = 0; i < numLen; i++) {
            const zC = zClampStart + (zClampEnd - zClampStart) * (i / (numLen - 1));
            let taper = 1.0;
            // バレットシンカーの先端テーパー受け
            if (sinkerType === "bullet" && zC < 0) {
                taper = Math.max(0.60, 1.0 + 0.40 * (zC / Math.abs(zClampStart)));
            } else if (sinkerType === "drop" && zC < 0) {
                taper = Math.max(0.55, 1.0 + 0.45 * (zC / Math.abs(zClampStart)));
            }

            // 前後脱落防止ストッパー爪 (先端と後端に内径を少し絞るリブ)
            let ribInner = 0.0;
            if (i === 0 || i === numLen - 1) {
                ribInner = 0.5; // 0.5mmの抜け止め爪
            }

            const rI = Math.max(2.0, (rIn * taper) - ribInner);
            const rO = rOut * taper;

            const inPts = [];
            const outPts = [];
            for (let j = 0; j < numCirc; j++) {
                const phi = phiStart + (phiEnd - phiStart) * (j / (numCirc - 1));
                const xI = rI * Math.sin(phi);
                const yI = zCenter - rI * Math.cos(phi);
                inPts.push([xI, yI, zC]);

                const xO = rO * Math.sin(phi);
                const yO = zCenter - rO * Math.cos(phi);
                outPts.push([xO, yO, zC]);
            }
            innerRings.push(inPts);
            outerRings.push(outPts);
        }

        const clampCol = [0.25, 0.45, 0.65];
        // 外面
        for (let i = 0; i < numLen - 1; i++) {
            for (let j = 0; j < numCirc - 1; j++) {
                const p1 = outerRings[i][j], p2 = outerRings[i][j+1], p3 = outerRings[i+1][j+1], p4 = outerRings[i+1][j];
                addTri(p1, p3, p2, clampCol, clampCol, clampCol);
                addTri(p1, p4, p3, clampCol, clampCol, clampCol);
            }
        }
        // 内面
        for (let i = 0; i < numLen - 1; i++) {
            for (let j = 0; j < numCirc - 1; j++) {
                const p1 = innerRings[i][j], p2 = innerRings[i][j+1], p3 = innerRings[i+1][j+1], p4 = innerRings[i+1][j];
                addTri(p1, p2, p3, clampCol, clampCol, clampCol);
                addTri(p1, p3, p4, clampCol, clampCol, clampCol);
            }
        }
        // 前後端面
        for (let idx of [0, numLen - 1]) {
            const flip = (idx === numLen - 1);
            for (let j = 0; j < numCirc - 1; j++) {
                const p1 = outerRings[idx][j], p2 = outerRings[idx][j+1], p3 = innerRings[idx][j+1], p4 = innerRings[idx][j];
                if (!flip) {
                    addTri(p1, p2, p3, clampCol, clampCol, clampCol);
                    addTri(p1, p3, p4, clampCol, clampCol, clampCol);
                } else {
                    addTri(p1, p3, p2, clampCol, clampCol, clampCol);
                    addTri(p1, p4, p3, clampCol, clampCol, clampCol);
                }
            }
        }
        // C字開口スリット面
        for (let side of [0, numCirc - 1]) {
            const flip = (side === 0);
            for (let i = 0; i < numLen - 1; i++) {
                const p1 = outerRings[i][side], p2 = outerRings[i+1][side], p3 = innerRings[i+1][side], p4 = innerRings[i][side];
                if (!flip) {
                    addTri(p1, p2, p3, clampCol, clampCol, clampCol);
                    addTri(p1, p3, p4, clampCol, clampCol, clampCol);
                } else {
                    addTri(p1, p3, p2, clampCol, clampCol, clampCol);
                    addTri(p1, p4, p3, clampCol, clampCol, clampCol);
                }
            }
        }

        // ==============================================================
        // 3. 自動伸縮テールブーム (Telescoping Tail Boom)
        // ==============================================================
        // クランプ後端 (zClampEnd) からテールアーム長 (zClampEnd + tailLength) まで伸びる剛性ブーム
        const boomZStart = zClampEnd;
        const boomZEnd = zClampEnd + tailLength;
        const boomW = 2.4; // 幅
        const boomH = 3.2; // 高さ
        const boomYCenter = zCenter + (rOut * 0.4);

        const b1 = [-boomW/2, boomYCenter - boomH/2, boomZStart];
        const b2 = [ boomW/2, boomYCenter - boomH/2, boomZStart];
        const b3 = [ boomW/2, boomYCenter + boomH/2, boomZStart];
        const b4 = [-boomW/2, boomYCenter + boomH/2, boomZStart];

        const b5 = [-boomW/2, boomYCenter - boomH/2, boomZEnd];
        const b6 = [ boomW/2, boomYCenter - boomH/2, boomZEnd];
        const b7 = [ boomW/2, boomYCenter + boomH/2, boomZEnd];
        const b8 = [-boomW/2, boomYCenter + boomH/2, boomZEnd];

        const boomCol = [0.35, 0.45, 0.55];
        // ブーム上面
        addTri(b4, b3, b7, boomCol, boomCol, boomCol); addTri(b4, b7, b8, boomCol, boomCol, boomCol);
        // ブーム下面
        addTri(b1, b6, b2, boomCol, boomCol, boomCol); addTri(b1, b5, b6, boomCol, boomCol, boomCol);
        // ブーム左面
        addTri(b1, b8, b5, boomCol, boomCol, boomCol); addTri(b1, b4, b8, boomCol, boomCol, boomCol);
        // ブーム右面
        addTri(b2, b6, b7, boomCol, boomCol, boomCol); addTri(b2, b7, b3, boomCol, boomCol, boomCol);
        // ブーム後端面
        addTri(b5, b7, b6, boomCol, boomCol, boomCol); addTri(b5, b8, b7, boomCol, boomCol, boomCol);

        // ==============================================================
        // 4. 水平尾翼 (Horizontal Stabilizer) - 連動計算された面積＆スパン
        // ==============================================================
        // ブーム後端付近に配置。主翼の頭下げモーメントを打ち消すトリム角 (-2度)
        const hZLead = boomZEnd - horizChord;
        const hZTrail = boomZEnd;
        const hThick = 1.6;
        const hSemiSpan = horizSpan / 2.0;

        const hCos = Math.cos(horizTrimRad);
        const hSin = Math.sin(horizTrimRad);

        function getHorizTailVerts(xH) {
            const zLocalLead = 0.0;
            const zLocalTrail = horizChord;
            const yL = boomYCenter;

            // トリム角回転
            const z1 = hZLead + zLocalLead * hCos;
            const y1 = yL + zLocalLead * hSin;

            const z2 = hZLead + zLocalTrail * hCos;
            const y2 = yL + zLocalTrail * hSin;

            return {
                fl: [xH, y1 - hThick/2, z1],
                fu: [xH, y1 + hThick/2, z1],
                rl: [xH, y2 - hThick/2, z2],
                ru: [xH, y2 + hThick/2, z2]
            };
        }

        const hRoot = getHorizTailVerts(boomW/2);
        const hTipR = getHorizTailVerts(hSemiSpan);
        const hRootL = getHorizTailVerts(-boomW/2);
        const hTipL = getHorizTailVerts(-hSemiSpan);

        const hCol = [0.2, 0.85, 0.7]; // 水平尾翼カラー (ミントグリーン)

        // 右側水平尾翼
        // 上面
        addTri(hRoot.fu, hTipR.fu, hTipR.ru, hCol, hCol, hCol);
        addTri(hRoot.fu, hTipR.ru, hRoot.ru, hCol, hCol, hCol);
        // 下面
        addTri(hRoot.fl, hTipR.rl, hTipR.fl, hCol, hCol, hCol);
        addTri(hRoot.fl, hRoot.rl, hTipR.rl, hCol, hCol, hCol);
        // 前縁
        addTri(hRoot.fu, hTipR.fl, hTipR.fu, hCol, hCol, hCol);
        addTri(hRoot.fu, hRoot.fl, hTipR.fl, hCol, hCol, hCol);
        // 後縁
        addTri(hRoot.ru, hTipR.ru, hTipR.rl, hCol, hCol, hCol);
        addTri(hRoot.ru, hTipR.rl, hRoot.rl, hCol, hCol, hCol);
        // 翼端キャップ
        addTri(hTipR.fu, hTipR.fl, hTipR.ru, hCol, hCol, hCol);
        addTri(hTipR.fl, hTipR.rl, hTipR.ru, hCol, hCol, hCol);

        // 左側水平尾翼
        addTri(hRootL.fu, hTipL.ru, hTipL.fu, hCol, hCol, hCol);
        addTri(hRootL.fu, hRootL.ru, hTipL.ru, hCol, hCol, hCol);
        addTri(hRootL.fl, hTipL.fl, hTipL.rl, hCol, hCol, hCol);
        addTri(hRootL.fl, hTipL.rl, hRootL.rl, hCol, hCol, hCol);
        addTri(hRootL.fu, hTipL.fu, hTipL.fl, hCol, hCol, hCol);
        addTri(hRootL.fu, hTipL.fl, hRootL.fl, hCol, hCol, hCol);
        addTri(hRootL.ru, hTipL.rl, hTipL.ru, hCol, hCol, hCol);
        addTri(hRootL.ru, hRootL.rl, hTipL.rl, hCol, hCol, hCol);
        addTri(hTipL.fu, hTipL.ru, hTipL.fl, hCol, hCol, hCol);
        addTri(hTipL.fl, hTipL.ru, hTipL.rl, hCol, hCol, hCol);

        // ==============================================================
        // 5. 垂直尾翼 (Vertical Stabilizer) - 連動計算された面積＆高さ
        // ==============================================================
        const vThick = 1.6;
        const vZStart = boomZEnd - finChord;
        const vZEnd = boomZEnd;
        const vYBase = boomYCenter + boomH/2;
        const vYTop = vYBase + finHeight;
        const vSweepZ = finHeight * 0.28; // 後退角

        const v1 = [-vThick/2, vYBase, vZStart];
        const v2 = [ vThick/2, vYBase, vZStart];
        const v3 = [ vThick/2, vYBase, vZEnd];
        const v4 = [-vThick/2, vYBase, vZEnd];

        const v5 = [-vThick/2, vYTop, vZStart + vSweepZ];
        const v6 = [ vThick/2, vYTop, vZStart + vSweepZ];
        const v7 = [ vThick/2, vYTop, vZEnd + vSweepZ * 0.6];
        const v8 = [-vThick/2, vYTop, vZEnd + vSweepZ * 0.6];

        const vCol = [0.38, 0.74, 0.98]; // 垂直尾翼カラー (シアン)
        // 右面
        addTri(v2, v3, v7, vCol, vCol, vCol); addTri(v2, v7, v6, vCol, vCol, vCol);
        // 左面
        addTri(v1, v8, v4, vCol, vCol, vCol); addTri(v1, v5, v8, vCol, vCol, vCol);
        // 前縁
        addTri(v2, v6, v5, vCol, vCol, vCol); addTri(v2, v5, v1, vCol, vCol, vCol);
        // 後縁
        addTri(v3, v4, v8, vCol, vCol, vCol); addTri(v3, v8, v7, vCol, vCol, vCol);
        // 上端面
        addTri(v5, v6, v7, vCol, vCol, vCol); addTri(v5, v7, v8, vCol, vCol, vCol);

        // フラット配列に変換
        const numTris = triangles.length;
        const flatVerts = new Float32Array(numTris * 9);
        const flatNorms = new Float32Array(numTris * 9);
        const flatColors = new Float32Array(numTris * 9);

        for (let i = 0; i < numTris; i++) {
            const tri = triangles[i];
            const p1 = tri[0], p2 = tri[1], p3 = tri[2];
            const col = vertColors[i];

            // 面法線計算
            const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
            const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
            let nx = ay * bz - az * by;
            let ny = az * bx - ax * bz;
            let nz = ax * by - ay * bx;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1.0;
            nx /= len; ny /= len; nz /= len;

            for (let vIdx = 0; vIdx < 3; vIdx++) {
                const p = tri[vIdx];
                const c = col[vIdx];
                const base = i * 9 + vIdx * 3;

                flatVerts[base] = p[0];
                flatVerts[base + 1] = p[1];
                flatVerts[base + 2] = p[2];

                flatNorms[base] = nx;
                flatNorms[base + 1] = ny;
                flatNorms[base + 2] = nz;

                flatColors[base] = c[0];
                flatColors[base + 1] = c[1];
                flatColors[base + 2] = c[2];
            }
        }

        return {
            triangles: triangles,
            vertices: flatVerts,
            normals: flatNorms,
            colors: flatColors,
            numTriangles: numTris
        };
    }

    /**
     * オモリ本体ダミーメッシュ (プレビュー用)
     */
    function buildSinkerDummyMesh(params) {
        const sinkerType = params.sinker_type || "bullet";
        const dia = parseFloat(params.diameter_mm) || 10.0;
        const length = parseFloat(params.length_mm) || 22.0;
        const r = dia / 2.0;
        const rOut = r + 0.28 + 1.7;
        const zCenter = -rOut * 0.35;

        const nTheta = 18;
        const nZ = 10;
        const zStart = -length * 0.45;
        const zEnd = length * 0.55;

        const rings = [];
        for (let i = 0; i < nZ; i++) {
            const z = zStart + (zEnd - zStart) * (i / (nZ - 1));
            const frac = (z - zStart) / Math.max(1.0, zEnd - zStart);
            let curR = r;
            if (sinkerType === "bullet" && frac < 0.6) {
                curR = r * Math.sin((frac / 0.6) * (Math.PI / 2.0));
            } else if (sinkerType === "drop") {
                curR = r * Math.sin(frac * Math.PI);
            } else if (sinkerType === "king_tenbin" && frac < 0.4) {
                curR = r * (0.4 + 0.6 * (frac / 0.4));
            }

            const ring = [];
            for (let j = 0; j < nTheta; j++) {
                const theta = (j / nTheta) * 2.0 * Math.PI;
                const x = curR * Math.sin(theta);
                const y = zCenter - curR * Math.cos(theta);
                ring.push([x, y, z]);
            }
            rings.push(ring);
        }

        const triangles = [];
        for (let i = 0; i < nZ - 1; i++) {
            const r1 = rings[i];
            const r2 = rings[i+1];
            for (let j = 0; j < nTheta; j++) {
                const jn = (j + 1) % nTheta;
                triangles.push([r1[j], r2[j], r2[jn]]);
                triangles.push([r1[j], r2[jn], r1[jn]]);
            }
        }
        // キャップ
        const cStart = [0, zCenter, zStart];
        const cEnd = [0, zCenter, zEnd];
        for (let j = 0; j < nTheta; j++) {
            const jn = (j + 1) % nTheta;
            triangles.push([cStart, rings[0][jn], rings[0][j]]);
            triangles.push([cEnd, rings[nZ-1][j], rings[nZ-1][jn]]);
        }

        const numTris = triangles.length;
        const flatVerts = new Float32Array(numTris * 9);
        const flatNorms = new Float32Array(numTris * 9);

        for (let i = 0; i < numTris; i++) {
            const tri = triangles[i];
            const p1 = tri[0], p2 = tri[1], p3 = tri[2];
            const ax = p2[0]-p1[0], ay = p2[1]-p1[1], az = p2[2]-p1[2];
            const bx = p3[0]-p1[0], by = p3[1]-p1[1], bz = p3[2]-p1[2];
            let nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1.0;
            nx /= len; ny /= len; nz /= len;

            for (let v = 0; v < 3; v++) {
                const p = tri[v];
                const base = i * 9 + v * 3;
                flatVerts[base] = p[0];
                flatVerts[base+1] = p[1];
                flatVerts[base+2] = p[2];
                flatNorms[base] = nx;
                flatNorms[base+1] = ny;
                flatNorms[base+2] = nz;
            }
        }

        return {
            vertices: flatVerts,
            normals: flatNorms,
            numTriangles: numTris
        };
    }

    /**
     * STLバイナリ Blob を生成 (3Dプリンタ出力用)
     * 3Dプリント時の姿勢: 垂直尾翼がZ軸上向き、主翼がXY平面に水平接地する標準姿勢で出力
     */
    function exportSTLBinary(triangles, headerText) {
        headerText = headerText || "TobiuoMakerGlider";
        const nTri = triangles.length;
        const bufferSize = 84 + nTri * 50;
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);

        // 80バイトヘッダー
        for (let i = 0; i < 80; i++) {
            view.setUint8(i, i < headerText.length ? headerText.charCodeAt(i) : 0);
        }
        // 三角形数
        view.setUint32(80, nTri, true);

        let offset = 84;
        for (let i = 0; i < nTri; i++) {
            const tri = triangles[i];
            const p1 = tri[0], p2 = tri[1], p3 = tri[2];

            // 3Dプリンタ向け座標変換:
            // メッシュ空間 (X:左右, Y:上下, Z:前後) -> STL空間 (X:左右, Y:前後, Z:上下/高さ)
            const v1 = [p1[0], p1[2], p1[1]];
            const v2 = [p2[0], p2[2], p2[1]];
            const v3 = [p3[0], p3[2], p3[1]];

            // 法線
            const ax = v2[0]-v1[0], ay = v2[1]-v1[1], az = v2[2]-v1[2];
            const bx = v3[0]-v1[0], by = v3[1]-v1[1], bz = v3[2]-v1[2];
            let nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1.0;
            nx /= len; ny /= len; nz /= len;

            view.setFloat32(offset, nx, true); offset += 4;
            view.setFloat32(offset, ny, true); offset += 4;
            view.setFloat32(offset, nz, true); offset += 4;

            view.setFloat32(offset, v1[0], true); offset += 4;
            view.setFloat32(offset, v1[1], true); offset += 4;
            view.setFloat32(offset, v1[2], true); offset += 4;

            view.setFloat32(offset, v2[0], true); offset += 4;
            view.setFloat32(offset, v2[1], true); offset += 4;
            view.setFloat32(offset, v2[2], true); offset += 4;

            view.setFloat32(offset, v3[0], true); offset += 4;
            view.setFloat32(offset, v3[1], true); offset += 4;
            view.setFloat32(offset, v3[2], true); offset += 4;

            view.setUint16(offset, 0, true); offset += 2;
        }

        return new Blob([buffer], { type: "application/octet-stream" });
    }

    exports.buildFullGliderMesh = buildFullGliderMesh;
    exports.buildSinkerDummyMesh = buildSinkerDummyMesh;
    exports.exportSTLBinary = exportSTLBinary;

})(typeof exports === 'undefined' ? (this.MeshGenerator = {}) : exports);
