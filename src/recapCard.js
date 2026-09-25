/*
 * The Recap share card: one year as a picture, sized for a phone screen and
 * for an Instagram post (4:5). It is drawn on a canvas here on the device, so
 * nothing about the year is sent anywhere to make it; the picture only goes
 * where its owner sends it.
 *
 * What goes on it is decided by recapCard() in PersonalCRM.jsx, which only
 * ever hands over counts, titles and ratings: never who anyone was with.
 * This file only draws.
 */

export const CARD_W = 1080;
export const CARD_H = 1350;

// The night-sky look of Orbit's dark theme, fixed so the picture is the same
// whichever theme it was made in.
const INK = '#E9EFFA';
const MUTED = '#9AA6BD';
const FAINT = '#56627A';
const ACCENT = '#72DE88';
const GOLD = '#F2C75C';
const LAND = '#1C2740';
const FONT = "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif";

const PAD = 72;

// Waits a moment for the app's font, and draws with the fallback if it has
// not come (offline, or blocked).
export const cardFontsReady = async () => {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const wait = new Promise((resolve) => { setTimeout(resolve, 1500); });
  try {
    await Promise.race([Promise.all([
      document.fonts.load(`600 80px ${FONT}`), document.fonts.load(`400 30px ${FONT}`),
    ]), wait]);
  } catch { /* the fallback font will do */ }
};

// Always the same scatter of stars, so the card does not change each time it
// is drawn.
const starsAt = () => {
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: 160 }, () => ({ x: next() * CARD_W, y: next() * CARD_H, r: 0.8 + next() * 1.8, a: 0.15 + next() * 0.45 }));
};

// Cuts text to fit, with an ellipsis.
const fit = (ctx, text, width) => {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

const starPath = (ctx, cx, cy, r) => {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + rad * Math.cos(a);
    const y = cy + rad * Math.sin(a);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
};

const starsWidth = (size) => 4 * size * 1.15 + size;

// Five stars with halves, the way the app shows them.
const drawStars = (ctx, n, x, cy, size) => {
  const r = size / 2;
  const gap = size * 1.15;
  for (let i = 1; i <= 5; i += 1) {
    const cx = x + r + (i - 1) * gap;
    starPath(ctx, cx, cy, r);
    ctx.fillStyle = FAINT;
    ctx.fill();
    const fill = n >= i ? 1 : n >= i - 0.5 ? 0.5 : 0;
    if (fill) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - r, cy - r, fill * 2 * r, 2 * r);
      ctx.clip();
      starPath(ctx, cx, cy, r);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.restore();
    }
  }
};

// The world, flat (longitude and latitude as x and y), with Antarctica and
// the far north cut off because nobody's year is spent there.
const MAP_TOP_LAT = 76;
const MAP_BOTTOM_LAT = -52;

const drawMap = (ctx, geo, { countries, pins }, box) => {
  const sx = box.w / 360;
  const sy = box.h / (MAP_TOP_LAT - MAP_BOTTOM_LAT);
  const px = (lng) => box.x + (lng + 180) * sx;
  const py = (lat) => box.y + (MAP_TOP_LAT - lat) * sy;
  const lit = new Set(countries);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  geo.COUNTRIES.forEach((c) => {
    const g = c.feature.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    ctx.beginPath();
    // A ring that crosses the date line (Russia, Fiji, the Aleutians) jumps
    // from +180 to -180. Carrying on past the edge instead keeps its shape,
    // and the clip trims what hangs off the map.
    polys.forEach((poly) => poly.forEach((ring) => {
      let shift = 0;
      let last = null;
      ring.forEach(([lng, lat], i) => {
        if (last !== null && lng + shift - last > 180) shift -= 360;
        else if (last !== null && last - (lng + shift) > 180) shift += 360;
        last = lng + shift;
        if (i) ctx.lineTo(px(last), py(lat)); else ctx.moveTo(px(last), py(lat));
      });
      ctx.closePath();
    }));
    ctx.fillStyle = lit.has(c.name) ? ACCENT : LAND;
    ctx.fill('evenodd');
  });
  pins.forEach(({ lat, lng }) => {
    ctx.beginPath();
    ctx.arc(px(lng), py(lat), 7, 0, Math.PI * 2);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#080D1A';
    ctx.stroke();
  });
  ctx.restore();
};

// card: { year, subtitle, name, stats: [{ n, label }], highlights: [{ label,
// title, rating, sub }], countries: [names], pins: [{ lat, lng }], site }.
// geo: the outlines module, or null to leave the map out.
export const drawRecapCard = (canvas, card, geo) => {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, CARD_H);
  sky.addColorStop(0, '#080D1A');
  sky.addColorStop(1, '#111A2E');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // Only in the margins and the open space beside the year, never over words.
  starsAt().filter((s) => s.x < PAD - 16 || s.x > CARD_W - PAD + 16 || (s.y > 130 && s.y < 250 && s.x > 620)).forEach((s) => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(233, 239, 250, ${s.a})`;
    ctx.fill();
  });

  ctx.textBaseline = 'alphabetic';

  // The mark and, if given, whose year it is.
  ctx.beginPath();
  ctx.arc(PAD + 11, 92, 11, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(PAD + 11, 92, 22, 8, -0.4, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText('Orbit', PAD + 46, 104);
  if (card.name) {
    ctx.font = `400 30px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, card.name, 520), CARD_W - PAD, 104);
    ctx.textAlign = 'left';
  }

  const mapped = geo && (card.countries.length || card.pins.length);
  // With no map the numbers get its room, and are drawn bigger.
  ctx.font = `600 ${mapped ? 160 : 190}px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(String(card.year), PAD - 8, mapped ? 290 : 330);
  ctx.font = `400 44px ${FONT}`;
  ctx.fillStyle = ACCENT;
  ctx.fillText(card.subtitle, PAD, mapped ? 352 : 400);

  const inner = CARD_W - PAD * 2;
  let y = mapped ? 392 : 450;
  if (mapped) {
    const h = Math.round((inner * (MAP_TOP_LAT - MAP_BOTTOM_LAT)) / 360);
    drawMap(ctx, geo, card, { x: PAD, y, w: inner, h });
    y += h + 40;
  }

  // Up to six numbers, three to a row.
  const colW = inner / 3;
  const rows = Math.ceil(card.stats.length / 3);
  const big = !mapped;
  const statH = big ? 180 : 130;
  card.stats.forEach((s, i) => {
    const x = PAD + (i % 3) * colW;
    const top = y + Math.floor(i / 3) * statH;
    ctx.font = `600 ${big ? 104 : 84}px ${FONT}`;
    ctx.fillStyle = i === 0 ? ACCENT : INK;
    ctx.fillText(fit(ctx, String(s.n), colW - 20), x, top + (big ? 100 : 78));
    ctx.font = `400 29px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(fit(ctx, s.label, colW - 20), x, top + (big ? 144 : 116));
  });
  y += rows * statH;

  // The best of the year, side by side: a label with its stars, the title,
  // and where and when.
  const hls = card.highlights.slice(0, 2);
  if (hls.length) {
    y += 20;
    ctx.fillStyle = 'rgba(233, 239, 250, 0.12)';
    ctx.fillRect(PAD, y, inner, 2);
    const gap = 40;
    const w = (inner - gap * (hls.length - 1)) / hls.length;
    hls.forEach((hl, i) => {
      const x = PAD + i * (w + gap);
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = ACCENT;
      const label = hl.label.toUpperCase();
      ctx.fillText(fit(ctx, label, w), x, y + 50);
      if (hl.rating) {
        const room = w - ctx.measureText(label).width - 20;
        const size = 26;
        if (room >= starsWidth(size)) drawStars(ctx, hl.rating, x + w - starsWidth(size), y + 42, size);
      }
      ctx.font = `600 ${hls.length > 1 ? 40 : 46}px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(fit(ctx, hl.title, w), x, y + 104);
      if (hl.sub) {
        ctx.font = `400 26px ${FONT}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(fit(ctx, hl.sub, w), x, y + 144);
      }
    });
  }

  ctx.font = `400 26px ${FONT}`;
  ctx.fillStyle = FAINT;
  ctx.fillText(card.site ? `Made with Orbit · ${card.site}` : 'Made with Orbit', PAD, CARD_H - 64);
};

export const cardBlob = (canvas) => new Promise((resolve) => {
  canvas.toBlob((b) => resolve(b), 'image/png');
});
