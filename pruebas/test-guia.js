// «Guía para imprimir»: el pentagrama de una canción propia con el color de cada mano, el nombre y el número de cada tecla.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {Data, NC, encodeNotes, goLearn, goFree, renderList, guiaPages, guiaEvents, decodeNotes, get guia(){ return guiaState; }, settings, guiaFile};\nNube.bind();`;
  return h.replace('Nube.bind();', hook);
}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Estrellita: mano derecha Do Do Sol Sol La La Sol, izquierda Do3 con acorde, una negra (Fa♯) y una pausa larga.
const RH = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
function cancion(){
  const notes = []; let t = 0;
  RH.forEach((m, i) => { notes.push({midi: m, start: t, dur: 0.9}); if (i % 4 === 0) notes.push({midi: 48, start: t, dur: 0.9}, {midi: 52, start: t, dur: 0.9}); t += 1; if (i === 6) t += 2; });
  notes.push({midi: 66, start: t, dur: 1});
  return notes;
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  async function open(vp, ajustes){
    const ctx = await browser.newContext({viewport: vp, acceptDownloads: true});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(a => { if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify(a)); }, ajustes);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    return page;
  }
  const txt = (page, sel) => page.evaluate(sel => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim(), sel);
  const nums = {60: 1, 62: 2, 64: 3, 65: 4, 67: 5, 69: 6, 48: 1, 52: 3};

  const A = await open({width: 1280, height: 800}, {device: 'tab-h', learnTab: 'canciones', marcas: {on: true, nums, div: 60}});
  const id = await A.evaluate(async notes => { const s = await __t.Data.addItem({kind: 'midi', title: 'Estrellita grabada', bpm: 120, notas: __t.encodeNotes(notes)}); return s.id; }, cancion());
  await A.evaluate(() => __t.goLearn()); await sleep(150);

  console.log('1. El botón');
  ok(await A.isVisible(`[data-guia="${id}"]`), 'la canción grabada tiene el botón de la guía en «Tus canciones»');
  ok((await A.locator('[data-guia]').count()) === 1, 'solo las canciones propias lo tienen');

  console.log('\n2. Cómo arma la guía');
  const ev = await A.evaluate(n => __t.guiaEvents(n.map(x => Object.assign({}, x))), cancion());
  ok(ev.length === 15 && ev[0].notes.length === 3, 'agrupa las notas que suenan juntas (acorde de la izquierda con la melodía)', ev.length);
  ok(ev[7].pause && !ev[6].pause && !ev[1].pause, 'marca la pausa larga y no las seguidas', ev.map(e => !!e.pause));

  await A.click(`[data-guia="${id}"]`); await A.waitForSelector('#guiaDlg[open]'); await sleep(150);
  const info = await txt(A, '#guiaInfo');
  ok(/^23 notas en 1 página/.test(info) && /derecha empieza en Do4/.test(info) && /orden de las notas/.test(info), 'dice cuántas notas, la división de manos y que no muestra el ritmo', info);
  ok(/1 nota no tiene número|Una nota no tiene número/.test(info), 'avisa que el Fa♯ no tiene número', info);
  ok((await A.locator('#guiaPages img').count()) === 1, 'muestra la página');

  // Mira los colores en la imagen: azul donde van las notas de la izquierda y rojo donde van las de la derecha.
  const px = await A.evaluate(() => {
    const cv = __t.guia.pages[0], c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
    let blue = 0, red = 0;
    for (let i = 0; i < d.length; i += 16){ const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.abs(r - 0x3C) < 12 && Math.abs(g - 0x5B) < 12 && Math.abs(b - 0xA3) < 12) blue++;
      if (Math.abs(r - 0xB0) < 12 && Math.abs(g - 0x3A) < 12 && Math.abs(b - 0x4E) < 12) red++; }
    return {blue, red, w: cv.width, h: cv.height};
  });
  ok(px.w === 1240 && px.h === 1754, 'la página es A4 (1240 × 1754)', px);
  ok(px.blue > 400 && px.red > 1500, 'tiene notas y fichas en azul (izquierda) y en rojo (derecha)', px);
  await A.evaluate(() => { const a = document.createElement('a'); a.id = 'x'; document.body.appendChild(a); });
  fs.writeFileSync(path.join(SHOTS, 'guia-pagina.png'), Buffer.from((await A.evaluate(() => __t.guia.urls[0])).split(',')[1], 'base64'));

  console.log('\n3. Descargar e imprimir');
  const dl = A.waitForEvent('download');
  await A.click('#guiaPng');
  const d = await dl;
  ok(d.suggestedFilename() === 'Estrellita grabada - guia.png', 'descarga un PNG con el nombre de la canción', d.suggestedFilename());
  await A.click('#guiaX');
  await A.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; window.__imgs = document.querySelectorAll('#guiaPrint img').length; }; });
  await A.click(`[data-guia="${id}"]`); await A.waitForSelector('#guiaDlg[open]');
  await A.click('#guiaPrintBtn'); await sleep(300);
  ok(await A.evaluate(() => window.__printed === 1 && window.__imgs === 1), 'imprimir abre la impresión con la página');
  ok(await A.evaluate(() => !document.querySelector('#guiaDlg').open), 'y cierra la ventana');
  await A.emulateMedia({media: 'print'});
  const vis = await A.evaluate(() => [getComputedStyle(document.querySelector('#guiaPrint')).display, getComputedStyle(document.querySelector('main')).display, getComputedStyle(document.querySelector('.board')).display]);
  ok(vis[0] === 'block' && vis[1] === 'none' && vis[2] === 'none', 'al imprimir solo sale la guía, no la app', vis);
  await A.emulateMedia({media: 'screen'});

  const fname = await A.evaluate(() => { const st = __t.guia; const old = st.title; st.title = 'Canción ñandú'; const f = __t.guiaFile(0); st.title = old; return f; });
  ok(fname === 'Cancion nandu - guia.png', 'quita tildes y eñes del nombre del archivo', fname);

  console.log('\n4. Canción larga y otra división');
  const long = [];
  for (let i = 0; i < 160; i++) long.push({midi: 55 + (i * 5) % 20, start: i, dur: 0.8});
  const g = await A.evaluate(n => { __t.NC.div = 64; const r = __t.guiaPages('Larga', n); __t.NC.div = 60; return {pages: r.pages.length, missing: r.missing}; }, long);
  ok(g.pages >= 2, 'una canción larga ocupa varias páginas', g);
  const id2 = await A.evaluate(async n => (await __t.Data.addItem({kind: 'midi', title: 'Larga', bpm: 120, notas: __t.encodeNotes(n)})).id, long);
  await A.evaluate(() => __t.renderList()); await sleep(100);
  await A.click(`[data-guia="${id2}"]`); await A.waitForSelector('#guiaDlg[open]'); await sleep(200);
  ok((await A.locator('#guiaPages img').count()) === g.pages && (await txt(A, '#guiaPng')) === `Descargar ${g.pages} imágenes`, 'muestra todas las páginas y ofrece descargarlas', await txt(A, '#guiaPng'));
  await A.screenshot({path: path.join(SHOTS, 'guia-ventana.png')});
  await A.click('#guiaX');

  console.log('\n5. Sin números todavía');
  const B = await open({width: 412, height: 860}, {device: 'cel-v', learnTab: 'canciones'});
  const idB = await B.evaluate(async notes => (await __t.Data.addItem({kind: 'midi', title: 'Sin números', bpm: 120, notas: __t.encodeNotes(notes)})).id, cancion());
  await B.evaluate(() => __t.goLearn()); await sleep(150);
  await B.click(`[data-guia="${idB}"]`); await B.waitForSelector('#guiaDlg[open]'); await sleep(150);
  ok(/Todavía no hay números en las teclas/.test(await txt(B, '#guiaInfo')), 'avisa que falta poner los números', await txt(B, '#guiaInfo'));
  const fit = await B.evaluate(() => { const r = document.querySelector('#guiaDlg').getBoundingClientRect(); return [r.right <= innerWidth + 1, r.bottom <= innerHeight + 1]; });
  ok(fit[0] && fit[1], 'en el celular la ventana cabe', fit);
  await B.screenshot({path: path.join(SHOTS, 'guia-celular.png')});

  ok(!errors.length, 'sin errores en la página', errors);
  console.log(`\n${pass} bien, ${failN} mal. Capturas en ${SHOTS}`);
  await browser.close(); server.close();
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
