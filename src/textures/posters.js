/**
 * SANDSTRIKE // posters texture set  (lib.posterAtlas)
 *
 * Used by materials: poster (8-cell atlas)
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 512px height canvas)
 *   roughnessMap   linear         (packed ORM for metal/rust/sheet)
 *   ormMap         R=AO G=rough B=metal  (metal surfaces only)
 *
 * Everything here is drawn with Canvas2D at load time; tune the constants in
 * this file to iterate on this material without touching the others.
 */
import * as THREE from 'three';
import { makeRNG } from '../utils.js';
import { FONT_CJK, FONT_DISPLAY, FONT_MONO, TAU, el, textureFromCanvas } from './core.js';
import { atlasCell, drawCell, weatherCell } from './atlas.js';

export function makePosterAtlas(aniso, reg) {
  const S = 1024;
  const cols = 4;
  const rows = 2;
  const c = el(S, S);
  const ctx = c.getContext('2d');

  function paper(w, h, tint = '#e2d3ae', seed = 1) {
    const rng = makeRNG(seed);
    ctx.fillStyle = tint;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 4 + rng() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rng() > 0.5 ? '120,92,52' : '250,240,214'},${0.04 + rng() * 0.1})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // torn / dog-eared corners
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18 + rng() * 26, 0);
    ctx.lineTo(0, 18 + rng() * 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w - 14 - rng() * 22, h);
    ctx.lineTo(w, h - 14 - rng() * 22);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // cell 0 — water ration
  drawCell(ctx, S, cols, rows, 0, 0, (cx, cw, ch) => {
    paper(cw, ch, '#e6d9b8', 11);
    cx.fillStyle = '#2f4a58';
    cx.fillRect(14, 18, cw - 28, 92);
    cx.fillStyle = '#eee3c6';
    cx.font = `900 38px ${FONT_DISPLAY}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('WATER RATION', cw / 2, 50);
    cx.font = `700 22px ${FONT_CJK}`;
    cx.fillText('配 水 通 知', cw / 2, 86);
    // droplet icon
    cx.fillStyle = '#3f6d80';
    cx.beginPath();
    cx.moveTo(cw / 2, 140);
    cx.bezierCurveTo(cw / 2 + 38, 186, cw / 2 + 24, 228, cw / 2, 228);
    cx.bezierCurveTo(cw / 2 - 24, 228, cw / 2 - 38, 186, cw / 2, 140);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,0.5)';
    cx.beginPath();
    cx.ellipse(cw / 2 - 9, 190, 7, 13, -0.4, 0, TAU);
    cx.fill();
    cx.fillStyle = '#3a2c1e';
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('06:00 – 09:00', cw / 2, 272);
    cx.fillText('SECTOR 7 ONLY', cw / 2, 300);
    cx.font = `700 34px ${FONT_MONO}`;
    cx.fillText('25 L / DAY', cw / 2, 352);
    cx.font = `700 16px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(58,44,30,0.7)';
    cx.fillText('BY ORDER OF OUTPOST COMMAND', cw / 2, 430);
    weatherCell(cx, cw, ch, 1201, 0.7);
  });

  // cell 1 — sector 7 ID
  drawCell(ctx, S, cols, rows, 1, 0, (cx, cw, ch) => {
    paper(cw, ch, '#d9ccb0', 12);
    cx.fillStyle = '#8a2e22';
    cx.fillRect(0, 0, cw, 24);
    cx.fillStyle = '#2a2118';
    cx.textAlign = 'center';
    cx.font = `900 66px ${FONT_DISPLAY}`;
    cx.fillText('SECTOR 7', cw / 2, 100);
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('OUTPOST 07 // PERSONNEL', cw / 2, 130);
    cx.fillStyle = '#b7a488';
    cx.fillRect(38, 150, cw - 76, 190);
    cx.fillStyle = '#3a3128';
    // robot portrait
    cx.beginPath();
    cx.moveTo(cw / 2 - 46, 322);
    cx.lineTo(cw / 2 - 52, 226);
    cx.lineTo(cw / 2 - 26, 196);
    cx.lineTo(cw / 2 + 26, 196);
    cx.lineTo(cw / 2 + 52, 226);
    cx.lineTo(cw / 2 + 46, 322);
    cx.closePath();
    cx.fill();
    cx.fillStyle = '#73e6ff';
    cx.fillRect(cw / 2 - 34, 240, 68, 12);
    cx.fillStyle = '#2a2118';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('UNIT Λ-07', cw / 2, 390);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillText('CLEARANCE: GOLD', cw / 2, 416);
    cx.fillRect(34, 434, cw - 68, 4);
    cx.fillStyle = 'rgba(42,33,24,0.6)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('PROPERTY OF SANDSTRIKE DIVISION', cw / 2, 462);
    weatherCell(cx, cw, ch, 1202, 0.8);
  });

  // cell 2 — ammo inventory
  drawCell(ctx, S, cols, rows, 2, 0, (cx, cw, ch) => {
    paper(cw, ch, '#c9c3aa', 13);
    cx.fillStyle = '#3d4230';
    cx.fillRect(16, 18, cw - 32, 64);
    cx.fillStyle = '#ded6bc';
    cx.textAlign = 'center';
    cx.font = `900 30px ${FONT_DISPLAY}`;
    cx.fillText('AMMUNITION', cw / 2, 48);
    cx.font = `700 16px ${FONT_CJK}`;
    cx.fillText('弹药库存 · Λ-07', cw / 2, 70);
    cx.textAlign = 'left';
    cx.fillStyle = '#2e2a20';
    cx.font = `700 17px ${FONT_MONO}`;
    const rowsData = [['5.56 ×45', '2,400'], ['7.62 ×51', '1,850'], ['12.7 ×99', '320'], ['40mm HEDP', '48'], ['CELLS · TYPE C', '96']];
    rowsData.forEach((r, i) => {
      const y = 116 + i * 44;
      cx.fillText(r[0], 28, y);
      cx.fillText(r[1], cw - 92, y);
      cx.fillStyle = 'rgba(46,42,32,0.25)';
      cx.fillRect(24, y + 12, cw - 48, 1);
      cx.fillStyle = '#2e2a20';
    });
    cx.fillStyle = '#8a2e22';
    cx.font = `900 20px ${FONT_DISPLAY}`;
    cx.fillText('DO NOT REMOVE', 28, 372);
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(46,42,32,0.75)';
    cx.fillText('FORM 07-AMMO REV.C', 28, 400);
    cx.fillStyle = 'rgba(60,54,40,0.35)';
    cx.fillRect(24, 420, cw - 48, 3);
    cx.fillStyle = 'rgba(60,54,40,0.25)';
    for (let i = 0; i < 5; i++) cx.fillRect(24 + i * 44, 432, 26, 26);
    weatherCell(cx, cw, ch, 1203, 0.9);
  });

  // cell 3 — hostile units warning
  drawCell(ctx, S, cols, rows, 3, 0, (cx, cw, ch) => {
    paper(cw, ch, '#ddc9a4', 14);
    cx.fillStyle = '#8a2e1c';
    cx.textAlign = 'center';
    cx.font = `900 34px ${FONT_DISPLAY}`;
    cx.fillText('CAUTION', cw / 2, 54);
    cx.font = `900 26px ${FONT_CJK}`;
    cx.fillText('敌 对 单 位', cw / 2, 90);
    // warning triangle
    cx.save();
    cx.translate(cw / 2, 210);
    cx.fillStyle = '#d8b23c';
    cx.beginPath();
    cx.moveTo(0, -100);
    cx.lineTo(96, 82);
    cx.lineTo(-96, 82);
    cx.closePath();
    cx.fill();
    cx.strokeStyle = '#2a2016';
    cx.lineWidth = 9;
    cx.stroke();
    cx.fillStyle = '#2a2016';
    cx.font = `900 96px ${FONT_DISPLAY}`;
    cx.fillText('!', 0, 30);
    cx.restore();
    cx.fillStyle = '#2a2016';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('AUTONOMOUS HOSTILES', cw / 2, 336);
    cx.fillText('ENGAGE ON SIGHT', cw / 2, 362);
    cx.fillStyle = '#8a2e1c';
    cx.fillRect(34, 386, cw - 68, 3);
    cx.fillStyle = 'rgba(42,32,22,0.6)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('SANDSTRIKE // 沙暴协议', cw / 2, 414);
    cx.fillText('07-ALPHA-9', cw / 2, 434);
    weatherCell(cx, cw, ch, 1204, 0.8);
  });

  // cell 4 — hand-painted A site arrow
  drawCell(ctx, S, cols, rows, 4, 1, (cx, cw, ch) => {
    cx.fillStyle = 'rgba(20,15,10,0.10)';
    cx.fillRect(0, 0, cw, ch);
    cx.strokeStyle = '#ece0c0';
    cx.lineWidth = 13;
    cx.lineCap = 'round';
    cx.globalAlpha = 0.86;
    cx.beginPath();
    cx.moveTo(cw / 2, 60);
    cx.lineTo(cw / 2, 300);
    cx.stroke();
    cx.beginPath();
    cx.moveTo(cw / 2 - 74, 236);
    cx.lineTo(cw / 2, 320);
    cx.lineTo(cw / 2 + 74, 236);
    cx.stroke();
    cx.font = `900 84px ${FONT_DISPLAY}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('A', cw / 2, 150);
    cx.font = `700 30px ${FONT_CJK}`;
    cx.fillText('A 点', cw / 2, 398);
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('ALPHA SITE', cw / 2, 442);
    cx.globalAlpha = 1;
    // rough streaks
    cx.strokeStyle = 'rgba(236,224,192,0.25)';
    cx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      cx.beginPath();
      cx.moveTo(30 + i * 28, 380 + (i % 3) * 8);
      cx.lineTo(20 + i * 28, 470);
      cx.stroke();
    }
    weatherCell(cx, cw, ch, 1205, 1.2);
  });

  // cell 5 — medevac
  drawCell(ctx, S, cols, rows, 5, 1, (cx, cw, ch) => {
    paper(cw, ch, '#e4dcc4', 16);
    cx.fillStyle = '#7d2620';
    cx.fillRect(0, 0, cw, 88);
    cx.fillStyle = '#f0e4c8';
    cx.textAlign = 'center';
    cx.font = `900 34px ${FONT_DISPLAY}`;
    cx.fillText('MEDEVAC', cw / 2, 52);
    cx.fillStyle = '#7d2620';
    cx.fillRect(cw / 2 - 60, 130, 120, 34);
    cx.fillRect(cw / 2 - 28, 102, 56, 90);
    cx.fillStyle = '#2f2a20';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('LZ: SOUTH COURTYARD', cw / 2, 268);
    cx.fillText('FREQ 121.500', cw / 2, 296);
    cx.font = `700 16px ${FONT_CJK}`;
    cx.fillText('伤员优先 · 保持通道畅通', cw / 2, 334);
    cx.strokeStyle = 'rgba(47,42,32,0.4)';
    cx.lineWidth = 2;
    cx.setLineDash([8, 6]);
    cx.strokeRect(28, 356, cw - 56, 72);
    cx.setLineDash([]);
    cx.fillStyle = 'rgba(47,42,32,0.65)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('07 / MEDICAL CORPS', cw / 2, 396);
    weatherCell(cx, cw, ch, 1206, 0.9);
  });

  // cell 6 — faded travel poster
  drawCell(ctx, S, cols, rows, 6, 1, (cx, cw, ch) => {
    paper(cw, ch, '#d8c4a0', 18);
    const sky = cx.createLinearGradient(0, 0, 0, ch * 0.62);
    sky.addColorStop(0, '#c98a5a');
    sky.addColorStop(0.65, '#e8cfa0');
    sky.addColorStop(1, '#f2e2bc');
    cx.fillStyle = sky;
    cx.fillRect(10, 10, cw - 20, ch * 0.62);
    // sun
    cx.fillStyle = 'rgba(255,240,200,0.9)';
    cx.beginPath();
    cx.arc(cw * 0.66, ch * 0.33, 34, 0, TAU);
    cx.fill();
    // dunes
    cx.fillStyle = '#c2915a';
    cx.beginPath();
    cx.moveTo(0, ch * 0.52);
    cx.quadraticCurveTo(cw * 0.35, ch * 0.4, cw, ch * 0.55);
    cx.lineTo(cw, ch * 0.64);
    cx.lineTo(0, ch * 0.64);
    cx.fill();
    cx.fillStyle = '#a8743f';
    cx.beginPath();
    cx.moveTo(0, ch * 0.58);
    cx.quadraticCurveTo(cw * 0.55, ch * 0.5, cw, ch * 0.62);
    cx.lineTo(cw, ch * 0.66);
    cx.lineTo(0, ch * 0.66);
    cx.fill();
    // palm silhouette
    cx.strokeStyle = '#4a3420';
    cx.lineWidth = 7;
    cx.beginPath();
    cx.moveTo(cw * 0.22, ch * 0.63);
    cx.quadraticCurveTo(cw * 0.24, ch * 0.5, cw * 0.28, ch * 0.4);
    cx.stroke();
    cx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI + (i / 5) * Math.PI;
      cx.beginPath();
      cx.moveTo(cw * 0.28, ch * 0.4);
      cx.quadraticCurveTo(cw * 0.28 + Math.cos(a) * 30, ch * 0.4 + Math.sin(a) * 10 - 6, cw * 0.28 + Math.cos(a) * 58, ch * 0.4 + Math.sin(a) * 26 + 4);
      cx.stroke();
    }
    cx.fillStyle = '#3a2c1c';
    cx.textAlign = 'center';
    cx.font = `900 44px ${FONT_DISPLAY}`;
    cx.fillText('SECTOR 7', cw / 2, ch * 0.76);
    cx.font = `700 20px ${FONT_CJK}`;
    cx.fillText('沙 漠 绿 洲 · 沙 暴 协 议', cw / 2, ch * 0.82);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(58,44,28,0.7)';
    cx.fillText('TRAVEL BUREAU · 07', cw / 2, ch * 0.88);
    weatherCell(cx, cw, ch, 1207, 0.8);
  });

  // cell 7 — 沙暴 poster
  drawCell(ctx, S, cols, rows, 7, 1, (cx, cw, ch) => {
    paper(cw, ch, '#d6c8a8', 19);
    cx.fillStyle = '#7d2a20';
    cx.fillRect(24, 24, cw - 48, ch - 48);
    cx.strokeStyle = '#e8d8b2';
    cx.lineWidth = 4;
    cx.strokeRect(38, 38, cw - 76, ch - 76);
    cx.fillStyle = '#e8d8b2';
    cx.textAlign = 'center';
    cx.font = `900 86px ${FONT_CJK}`;
    cx.fillText('沙 暴', cw / 2, 190);
    cx.font = `700 40px ${FONT_CJK}`;
    cx.fillText('协 议', cw / 2, 254);
    cx.fillStyle = '#d8b878';
    cx.fillRect(cw * 0.3, 282, cw * 0.4, 4);
    cx.fillStyle = '#e8d8b2';
    cx.font = `900 26px ${FONT_DISPLAY}`;
    cx.fillText('SANDSTRIKE', cw / 2, 326);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillText('OUTPOST 07 // 07:41', cw / 2, 356);
    // stamp
    cx.save();
    cx.translate(cw / 2, 414);
    cx.rotate(-0.12);
    cx.strokeStyle = 'rgba(232,216,178,0.75)';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(0, 0, 40, 0, TAU);
    cx.stroke();
    cx.font = `900 20px ${FONT_MONO}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('SECURED', 0, 0);
    cx.restore();
    weatherCell(cx, cw, ch, 1208, 0.7);
  });

  const texture = textureFromCanvas(c, { aniso });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  reg(texture);
  const cells = {};
  const names = ['water', 'sector', 'ammo', 'hostile', 'aArrow', 'medevac', 'travel', 'shabao'];
  names.forEach((name, i) => {
    cells[name] = atlasCell(S, cols, rows, i % cols, Math.floor(i / cols));
  });
  return { texture, cells };
}
