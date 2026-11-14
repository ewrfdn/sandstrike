/**
 * SANDSTRIKE // decals texture set  (lib.decalAtlas)
 *
 * Used by materials: decal (16-cell atlas)
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
import { FONT_DISPLAY, FONT_MONO, TAU, el, textureFromCanvas } from './core.js';
import { atlasCell, drawCell, weatherCell } from './atlas.js';

export function makeDecalAtlas(aniso, reg) {
  const S = 1024;
  const cols = 4;
  const rows = 4;
  const c = el(S, S);
  const ctx = c.getContext('2d');

  function paint(cx, cw, ch, fn) {
    cx.save();
    fn(cx, cw, ch);
    cx.restore();
  }

  // 0 — A site ground stencil
  drawCell(ctx, S, cols, rows, 0, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#efe3c4';
      c2.lineWidth = 17;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 96, 0, TAU);
      c2.stroke();
      c2.lineWidth = 5;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 116, 0, TAU);
      c2.stroke();
      c2.fillStyle = '#efe3c4';
      c2.font = `900 168px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('A', cw / 2, ch / 2 + 6);
    });
    weatherCell(cx, cw, ch, 2100, 1.4);
  });

  // 1 — B site ground stencil
  drawCell(ctx, S, cols, rows, 1, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#e6e1cc';
      c2.lineWidth = 17;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 96, 0, TAU);
      c2.stroke();
      c2.lineWidth = 5;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 116, 0, TAU);
      c2.stroke();
      c2.fillStyle = '#e6e1cc';
      c2.font = `900 168px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('B', cw / 2, ch / 2 + 6);
    });
    weatherCell(cx, cw, ch, 2101, 1.4);
  });

  // 2 — arrow (points +V i.e. up in cell; rotate plane as needed)
  drawCell(ctx, S, cols, rows, 2, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = '#ece0c0';
      c2.beginPath();
      c2.moveTo(cw / 2, 26);
      c2.lineTo(cw - 34, 132);
      c2.lineTo(cw / 2 + 34, 132);
      c2.lineTo(cw / 2 + 34, ch - 26);
      c2.lineTo(cw / 2 - 34, ch - 26);
      c2.lineTo(cw / 2 - 34, 132);
      c2.lineTo(34, 132);
      c2.closePath();
      c2.fill();
    });
    weatherCell(cx, cw, ch, 2102, 1.2);
  });

  // 3 — hazard stripe band
  drawCell(ctx, S, cols, rows, 3, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.save();
      c2.translate(0, ch * 0.32);
      c2.beginPath();
      c2.rect(0, 0, cw, ch * 0.36);
      c2.clip();
      c2.fillStyle = '#d8b23c';
      c2.fillRect(0, 0, cw, ch * 0.36);
      c2.fillStyle = '#2a2118';
      for (let x = -60; x < cw + 60; x += 64) {
        c2.beginPath();
        c2.moveTo(x, 0);
        c2.lineTo(x + 32, 0);
        c2.lineTo(x + 32 + ch * 0.36, ch * 0.36);
        c2.lineTo(x + ch * 0.36, ch * 0.36);
        c2.closePath();
        c2.fill();
      }
      c2.restore();
    });
    weatherCell(cx, cw, ch, 2103, 1.6);
  });

  // 4 — graffiti tag
  drawCell(ctx, S, cols, rows, 0, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ff8a3c';
      c2.lineWidth = 11;
      c2.lineCap = 'round';
      c2.font = `900 74px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.save();
      c2.translate(cw / 2, ch / 2);
      c2.rotate(-0.12);
      c2.fillStyle = 'rgba(255,138,60,0.85)';
      c2.fillText('SNDSTK', 0, -26);
      c2.fillStyle = 'rgba(115,230,255,0.8)';
      c2.font = `900 54px ${FONT_DISPLAY}`;
      c2.fillText('Λ-07', 0, 40);
      c2.strokeStyle = 'rgba(255,138,60,0.4)';
      c2.lineWidth = 4;
      c2.beginPath();
      c2.moveTo(-cw * 0.36, 74);
      c2.lineTo(cw * 0.36, 60);
      c2.stroke();
      c2.restore();
      // overspray
      const rng = makeRNG(2104);
      c2.fillStyle = 'rgba(255,138,60,0.25)';
      for (let i = 0; i < 90; i++) {
        c2.beginPath();
        c2.arc(cw / 2 + (rng() - 0.5) * 190, ch / 2 + (rng() - 0.5) * 150, 0.5 + rng() * 1.8, 0, TAU);
        c2.fill();
      }
    });
    weatherCell(cx, cw, ch, 2105, 0.7);
  });

  // 5 — robot skull graffiti
  drawCell(ctx, S, cols, rows, 1, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = 'rgba(115,230,255,0.9)';
      c2.fillStyle = 'rgba(115,230,255,0.85)';
      c2.lineWidth = 8;
      c2.beginPath();
      c2.moveTo(cw / 2 - 56, ch / 2 + 30);
      c2.lineTo(cw / 2 - 54, ch / 2 - 34);
      c2.lineTo(cw / 2 - 26, ch / 2 - 66);
      c2.lineTo(cw / 2 + 26, ch / 2 - 66);
      c2.lineTo(cw / 2 + 54, ch / 2 - 34);
      c2.lineTo(cw / 2 + 56, ch / 2 + 30);
      c2.closePath();
      c2.stroke();
      c2.fillRect(cw / 2 - 34, ch / 2 - 34, 24, 12);
      c2.fillRect(cw / 2 + 10, ch / 2 - 34, 24, 12);
      c2.strokeStyle = 'rgba(115,230,255,0.5)';
      c2.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        c2.beginPath();
        c2.moveTo(cw / 2 - 32 + i * 32, ch / 2 + 6);
        c2.lineTo(cw / 2 - 32 + i * 32, ch / 2 + 26);
        c2.stroke();
      }
      c2.fillStyle = 'rgba(115,230,255,0.35)';
      c2.fillRect(cw / 2 - 74, ch / 2 + 62, 148, 6);
    });
    weatherCell(cx, cw, ch, 2106, 1.0);
  });

  // 6 — oil stain
  drawCell(ctx, S, cols, rows, 2, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2107);
      c2.fillStyle = 'rgba(24,18,12,0.62)';
      c2.beginPath();
      c2.ellipse(cw / 2, ch / 2, 92, 62, 0.2, 0, TAU);
      c2.fill();
      for (let i = 0; i < 9; i++) {
        c2.beginPath();
        c2.ellipse(cw / 2 + (rng() - 0.5) * 150, ch / 2 + (rng() - 0.5) * 100, 8 + rng() * 32, 5 + rng() * 18, rng() * TAU, 0, TAU);
        c2.fill();
      }
      c2.fillStyle = 'rgba(70,52,30,0.22)';
      c2.beginPath();
      c2.ellipse(cw / 2 + 20, ch / 2 - 6, 34, 22, 0.4, 0, TAU);
      c2.fill();
    });
    weatherCell(cx, cw, ch, 2108, 0.3);
  });

  // 7 — tire tracks
  drawCell(ctx, S, cols, rows, 3, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(30,22,14,0.36)';
      for (const off of [-46, 46]) {
        c2.fillRect(cw / 2 + off - 24, 10, 48, ch - 20);
        // tread blocks
        c2.globalCompositeOperation = 'destination-out';
        c2.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = 10; y < ch - 20; y += 26) c2.fillRect(cw / 2 + off - 26, y, 52, 11);
        c2.globalCompositeOperation = 'source-over';
        c2.fillStyle = 'rgba(30,22,14,0.36)';
      }
    });
    weatherCell(cx, cw, ch, 2109, 0.6);
  });

  // 8 — paint splatter
  drawCell(ctx, S, cols, rows, 0, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2110);
      c2.fillStyle = 'rgba(232,220,192,0.85)';
      for (let i = 0; i < 34; i++) {
        const a = rng() * TAU;
        const r = rng() * 92;
        c2.beginPath();
        c2.ellipse(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r, 1.5 + rng() * 13, 1 + rng() * 9, rng() * TAU, 0, TAU);
        c2.fill();
      }
    });
    weatherCell(cx, cw, ch, 2111, 0.8);
  });

  // 9 — "07" stencil
  drawCell(ctx, S, cols, rows, 1, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = '#ece0c0';
      c2.font = `900 150px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('07', cw / 2, ch / 2 - 10);
      c2.fillStyle = 'rgba(236,224,192,0.8)';
      c2.fillRect(cw * 0.24, ch * 0.72, cw * 0.52, 8);
      c2.font = `700 26px ${FONT_MONO}`;
      c2.fillText('SECTOR', cw / 2, ch * 0.84);
    });
    weatherCell(cx, cw, ch, 2112, 1.1);
  });

  // 10 — X cross
  drawCell(ctx, S, cols, rows, 2, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ece0c0';
      c2.lineWidth = 20;
      c2.lineCap = 'round';
      c2.beginPath();
      c2.moveTo(52, 52);
      c2.lineTo(cw - 52, ch - 52);
      c2.moveTo(cw - 52, 52);
      c2.lineTo(52, ch - 52);
      c2.stroke();
    });
    weatherCell(cx, cw, ch, 2113, 1.0);
  });

  // 11 — grime patch
  drawCell(ctx, S, cols, rows, 3, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2114);
      for (let i = 0; i < 40; i++) {
        const x = cw / 2 + (rng() - 0.5) * 170;
        const y = ch / 2 + (rng() - 0.5) * 170;
        const r = 10 + rng() * 70;
        const g = c2.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(26,18,10,${0.05 + rng() * 0.14})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c2.fillStyle = g;
        c2.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  });

  // 12 — bullet pock cluster (pre-existing battle damage)
  drawCell(ctx, S, cols, rows, 0, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2115);
      for (let i = 0; i < 16; i++) {
        const x = 30 + rng() * (cw - 60);
        const y = 30 + rng() * (ch - 60);
        const r = 2 + rng() * 4.5;
        c2.fillStyle = 'rgba(24,18,12,0.85)';
        c2.beginPath();
        c2.arc(x, y, r, 0, TAU);
        c2.fill();
        c2.strokeStyle = 'rgba(226,216,196,0.5)';
        c2.lineWidth = 1.4;
        c2.beginPath();
        c2.arc(x, y, r + 1.4, 0, TAU);
        c2.stroke();
        c2.fillStyle = 'rgba(226,216,196,0.16)';
        c2.beginPath();
        c2.arc(x + r * 1.6, y + r * 1.4, r * 0.8, 0, TAU);
        c2.fill();
      }
    });
  });

  // 13 — warning triangle
  drawCell(ctx, S, cols, rows, 1, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(216,178,60,0.9)';
      c2.beginPath();
      c2.moveTo(cw / 2, 30);
      c2.lineTo(cw - 20, ch - 34);
      c2.lineTo(20, ch - 34);
      c2.closePath();
      c2.fill();
      c2.strokeStyle = 'rgba(42,33,24,0.9)';
      c2.lineWidth = 9;
      c2.stroke();
      c2.fillStyle = '#2a2118';
      c2.font = `900 110px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('!', cw / 2, ch / 2 + 24);
    });
    weatherCell(cx, cw, ch, 2116, 1.0);
  });

  // 14 — footprints
  drawCell(ctx, S, cols, rows, 2, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(40,30,18,0.30)';
      for (let i = 0; i < 8; i++) {
        const y = 24 + i * 28;
        const x = cw / 2 + (i % 2 === 0 ? -22 : 22);
        c2.save();
        c2.translate(x, y);
        c2.rotate((i % 2 === 0 ? 1 : -1) * 0.08);
        c2.beginPath();
        c2.ellipse(0, 0, 13, 20, 0, 0, TAU);
        c2.fill();
        c2.beginPath();
        c2.ellipse(0, 24, 8, 8, 0, 0, TAU);
        c2.fill();
        c2.restore();
      }
    });
    weatherCell(cx, cw, ch, 2117, 1.0);
  });

  // 15 — direction chevrons (double)
  drawCell(ctx, S, cols, rows, 3, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ece0c0';
      c2.lineWidth = 22;
      c2.lineCap = 'round';
      for (const oy of [-52, 34]) {
        c2.beginPath();
        c2.moveTo(52, ch / 2 + oy + 56);
        c2.lineTo(cw / 2, ch / 2 + oy - 26);
        c2.lineTo(cw - 52, ch / 2 + oy + 56);
        c2.stroke();
      }
    });
    weatherCell(cx, cw, ch, 2118, 1.0);
  });

  const texture = textureFromCanvas(c, { aniso });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  reg(texture);
  const cells = {};
  const names = [
    'siteA', 'siteB', 'arrow', 'hazard',
    'tag', 'skull', 'oil', 'tracks',
    'splat', 'num07', 'cross', 'grime',
    'chips', 'warn', 'footprints', 'chevrons',
  ];
  names.forEach((name, i) => {
    cells[name] = atlasCell(S, cols, rows, i % cols, Math.floor(i / cols));
  });
  return { texture, cells };
}
