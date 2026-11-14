/**
 * SANDSTRIKE // banners texture set  (lib.banners)
 *
 * Used by materials: bannerA / bannerB / bannerTitle / bannerWarn
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
import { shadeFolds, tearClothEdges } from './cloth-common.js';

export function makeBanners(aniso, reg) {
  function bannerCloth(w, h, draw) {
    const c = el(w, h);
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    return c;
  }

  function baseCloth(ctx, w, h, top, bottom, seed) {
    const rng = makeRNG(seed);
    const g = ctx.createLinearGradient(0, 0, w * 0.2, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // woven texture
    ctx.save();
    ctx.globalAlpha = 0.1;
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? '#000' : '#fff';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
    // stains and sun fade
    for (let i = 0; i < 30; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 12 + rng() * 100;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rng() > 0.5 ? `rgba(255,236,200,${0.04 + rng() * 0.09})` : `rgba(24,14,8,${0.05 + rng() * 0.1})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    shadeFolds(ctx, w, h, { count: 9, vertical: true, alpha: 0.06, seed: seed + 1 });
  }

  function bannerStandard(letter, label, cjk, bgTop, bgBottom, ink, accent, seed) {
    const w = 512;
    const h = 1024;
    const c = bannerCloth(w, h, (ctx) => {
      baseCloth(ctx, w, h, bgTop, bgBottom, seed);
      // stitched border
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 9;
      ctx.strokeRect(26, 26, w - 52, h - 52);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.setLineDash([11, 9]);
      ctx.strokeRect(42, 42, w - 84, h - 84);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // ring + big letter
      ctx.strokeStyle = ink;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.34, 158, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.34, 178, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.font = `900 280px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, w / 2, h * 0.345 + 8);
      // labels
      ctx.fillStyle = ink;
      ctx.font = `900 82px ${FONT_DISPLAY}`;
      ctx.fillText(label, w / 2, h * 0.60);
      ctx.font = `700 46px ${FONT_CJK}`;
      ctx.globalAlpha = 0.9;
      ctx.fillText(cjk, w / 2, h * 0.675);
      ctx.globalAlpha = 0.78;
      ctx.font = `700 30px ${FONT_MONO}`;
      ctx.fillText('SANDSTRIKE // 沙暴协议', w / 2, h * 0.775);
      // tail stripes
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = accent;
      ctx.fillRect(w * 0.22, h * 0.845, w * 0.56, 10);
      ctx.fillRect(w * 0.28, h * 0.875, w * 0.44, 5);
      // weathering
      ctx.globalCompositeOperation = 'destination-out';
      const rng = makeRNG(seed + 99);
      for (let i = 0; i < 300; i++) {
        ctx.globalAlpha = 0.12 + rng() * 0.35;
        ctx.beginPath();
        ctx.arc(rng() * w, rng() * h, 0.6 + rng() * 2.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      tearClothEdges(ctx.canvas, { bottom: true, sides: true, seed: seed + 7, depth: 30 });
    });
    const tex = textureFromCanvas(c, { aniso });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return reg(tex);
  }

  const a = bannerStandard('A', 'ALPHA', 'A 点 · 阿尔法', '#7d2a1e', '#5a1a12', '#e9d8b4', '#d8b878', 4100);
  const b = bannerStandard('B', 'BRAVO', 'B 点 · 布拉沃', '#20424a', '#122a30', '#e2ddc4', '#8fd8d4', 4200);

  // wide title banner
  const tw = 1024;
  const th = 512;
  const title = bannerCloth(tw, th, (ctx) => {
    baseCloth(ctx, tw, th, '#221c15', '#14100b', 4300);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ff8a3c';
    for (let i = -2; i < 8; i++) {
      ctx.save();
      ctx.translate(i * 180, 0);
      ctx.rotate(-0.35);
      ctx.fillRect(0, -200, 26, th + 400);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#ff8a3c';
    ctx.lineWidth = 6;
    ctx.strokeRect(30, 30, tw - 60, th - 60);
    ctx.fillStyle = '#f2e4c6';
    ctx.font = `900 132px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SANDSTRIKE', tw / 2, th * 0.37, tw * 0.84);
    ctx.fillStyle = '#ff8a3c';
    ctx.font = `900 74px ${FONT_CJK}`;
    ctx.fillText('沙 暴 协 议', tw / 2, th * 0.56, tw * 0.7);
    ctx.fillStyle = '#bdb096';
    ctx.font = `700 30px ${FONT_MONO}`;
    ctx.fillText('OUTPOST 07 // SECTOR SEVEN // 07:41 LOCAL', tw / 2, th * 0.72);
    ctx.fillStyle = '#73e6ff';
    ctx.fillRect(tw * 0.35, th * 0.79, tw * 0.3, 4);
    ctx.globalCompositeOperation = 'destination-out';
    const rng = makeRNG(4301);
    for (let i = 0; i < 340; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.3;
      ctx.beginPath();
      ctx.arc(rng() * tw, rng() * th, 0.5 + rng() * 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    tearClothEdges(ctx.canvas, { bottom: false, sides: true, seed: 4302, depth: 12 });
    shadeFolds(ctx, tw, th, { count: 6, vertical: true, alpha: 0.05, seed: 4303 });
  });
  const titleTex = textureFromCanvas(title, { aniso });

  // hazard warning banner
  const warn = bannerCloth(1024, 512, (ctx) => {
    baseCloth(ctx, 1024, 512, '#c79a2c', '#a87c1c', 4400);
    // hazard bands top & bottom
    ctx.save();
    for (const y of [70, 390]) {
      ctx.save();
      ctx.translate(0, y);
      ctx.beginPath();
      ctx.rect(26, 0, 1024 - 52, 52);
      ctx.clip();
      ctx.fillStyle = '#16130d';
      for (let x = -80; x < 1120; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 40, 0);
        ctx.lineTo(x + 80, 52);
        ctx.lineTo(x + 40, 52);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#16130d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 88px ${FONT_DISPLAY}`;
    ctx.fillText('RESTRICTED AREA', 512, 205, 1024 * 0.82);
    ctx.font = `900 64px ${FONT_CJK}`;
    ctx.fillText('军 事 禁 区', 512, 290, 1024 * 0.6);
    ctx.font = `700 28px ${FONT_MONO}`;
    ctx.fillText('AUTHORIZED PERSONNEL ONLY · 07', 512, 348);
    ctx.globalCompositeOperation = 'destination-out';
    const rng = makeRNG(4401);
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.35;
      ctx.beginPath();
      ctx.arc(rng() * 1024, rng() * 512, 0.6 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    shadeFolds(ctx, 1024, 512, { count: 5, vertical: true, alpha: 0.05, seed: 4402 });
    tearClothEdges(ctx.canvas, { bottom: false, sides: true, seed: 4403, depth: 10 });
  });
  const warnTex = textureFromCanvas(warn, { aniso });

  return { a, b, title: reg(titleTex), warn: reg(warnTex) };
}
