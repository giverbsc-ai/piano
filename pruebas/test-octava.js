// «Subir o bajar una octava» en Tus canciones: crea una copia en otra octava y deja la original igual.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  return h.replace('Nube.bind();', 'window.__t = {Data, settings, decodeNotes, encodeNotes, goLearn, renderList, saveSettings};\nNube.bind();');
}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  const ctx = await browser.newContext({viewport: {width: 1180, height: 760}});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.addInitScript(() => { if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify({device: 'tab-h', learnTab: 'canciones'})); sessionStorage.setItem('piano:sin-cuenta', '1'); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await page.waitForFunction(() => window.__t);

  // Una canción grabada de Do4 a Mi6, con notas en las dos manos, y otra que llega al tope del piano.
  const orig = '60:0:12:0 64:12:12:0 67:24:12:0 88:36:24:0 48:0:48:1 55:24:24:1';
  await page.evaluate(async orig => {
    await __t.Data.addItem({kind: 'midi', title: 'Mi canción', bpm: 120, notas: orig, nivel: 4});
    await __t.Data.addItem({kind: 'midi', title: 'Muy aguda', bpm: 100, notas: '100:0:12:0 105:12:12:0'});
    const s = __t.Data.items.find(x => x.title === 'Mi canción');
    __t.settings.niveles = Object.assign({}, __t.settings.niveles, {[s.key]: 2}); __t.saveSettings();
    __t.goLearn();
  }, orig);
  await sleep(200);

  console.log('1. Botón y panel');
  const nOct = await page.$$eval('[data-oct]', b => b.length);
  ok(nOct === 2, 'cada canción propia tiene el botón 8ª', nOct);
  const id = await page.evaluate(() => __t.Data.items.find(x => x.title === 'Mi canción').id);
  await page.click(`[data-oct="${id}"]`); await sleep(150);
  const panel = await page.$eval('.oct-row', el => el.textContent);
  ok(/Do3 a Mi6/.test(panel), 'el panel dice de qué nota a qué nota va (la mano izquierda empieza en Do3)', panel);
  await page.screenshot({path: path.join(SHOTS, 'octava-panel.png')});
  ok(await page.$eval(`[data-octgo="${id}:12"]`, b => !b.disabled) && await page.$eval(`[data-octgo="${id}:-12"]`, b => !b.disabled), 'se puede subir y bajar');

  console.log('2. Subir una octava');
  await page.click(`[data-octgo="${id}:12"]`); await sleep(300);
  const r = await page.evaluate(id => {
    const items = __t.Data.items.filter(x => x.kind === 'midi');
    const o = items.find(x => x.id === id), c = items[items.length - 1];
    return {n: items.length, ot: o.title, on: o.notas, ct: c.title, cn: c.notas, cb: c.bpm, cl: c.nivel, ck: c.key, lvl: __t.settings.niveles[c.key],
      msg: document.querySelector('#songList .msg')?.textContent || '', panel: !!document.querySelector('.oct-row')};
  }, id);
  ok(r.n === 3, 'hay una canción más', r.n);
  ok(r.on === orig && r.ot === 'Mi canción', 'la original no cambió');
  ok(r.ct === 'Mi canción (octava arriba)', 'la copia se llama «… (octava arriba)»', r.ct);
  const shifted = orig.split(' ').map(t => { const p = t.split(':'); p[0] = +p[0] + 12; return p.join(':'); }).join(' ');
  ok(r.cn === shifted, 'cada nota subió 12 teclas, con el mismo ritmo y la misma mano', [r.cn, shifted]);
  ok(r.cb === 120 && r.cl === 4 && r.lvl === 2, 'conserva la velocidad, el nivel y la dificultad elegida', [r.cb, r.cl, r.lvl]);
  ok(/Do4 a Mi7/.test(r.msg) && /original no cambió/.test(r.msg), 'el aviso dice el nuevo rango', r.msg);
  ok(/fuera de un teclado de 61 teclas/.test(r.msg), 'y advierte que Mi7 está fuera de un teclado de 61 teclas');
  ok(!r.panel, 'el panel se cierra');

  console.log('3. Bajar la copia vuelve a la original');
  const cid = await page.evaluate(() => { const it = __t.Data.items; return it[it.length - 1].id; });
  await page.click(`[data-oct="${cid}"]`); await sleep(120);
  await page.click(`[data-octgo="${cid}:-12"]`); await sleep(300);
  const r2 = await page.evaluate(() => { const it = __t.Data.items; const c = it[it.length - 1]; return {t: c.title, n: c.notas, msg: document.querySelector('#songList .msg')?.textContent || ''}; });
  ok(r2.t === 'Mi canción (octava abajo)' && r2.n === orig, 'queda igual a la original y el nombre no se alarga', r2);
  ok(!/fuera de un teclado/.test(r2.msg), 'sin aviso cuando cabe en el teclado', r2.msg);

  console.log('4. Límites del piano');
  const hid = await page.evaluate(() => __t.Data.items.find(x => x.title === 'Muy aguda').id);
  await page.click(`[data-oct="${hid}"]`); await sleep(120);
  ok(await page.$eval(`[data-octgo="${hid}:12"]`, b => b.disabled), 'no deja subir si alguna nota pasaría del Do8');
  ok(!(await page.$eval(`[data-octgo="${hid}:-12"]`, b => b.disabled)), 'pero sí bajar');
  await page.click(`[data-oct="${hid}"]`); await sleep(120);
  ok(!(await page.$('.oct-row')), 'un segundo toque en 8ª cierra el panel');

  console.log('5. Guardado y práctica');
  await page.reload(); await page.waitForFunction(() => window.__t); await sleep(200);
  const titles = await page.evaluate(() => __t.Data.items.map(x => x.title));
  ok(titles.includes('Mi canción (octava arriba)') && titles.includes('Mi canción (octava abajo)'), 'las copias siguen al recargar', titles);
  await page.evaluate(() => __t.goLearn()); await sleep(200);
  const k = await page.evaluate(() => __t.Data.items.find(x => x.title === 'Mi canción (octava arriba)').key);
  await page.click(`[data-id="${k}"]`); await sleep(400);
  ok(await page.evaluate(() => document.body.dataset.view || document.querySelector('#player') !== null), 'la copia se abre para practicar');

  console.log('6. Celular angosto');
  const cc = await browser.newContext({viewport: {width: 360, height: 740}});
  await cc.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await cc.addInitScript(() => { localStorage.setItem('piano:ajustes', JSON.stringify({device: 'cel-v', learnTab: 'canciones'})); sessionStorage.setItem('piano:sin-cuenta', '1'); });
  const ph = await cc.newPage(); ph.on('pageerror', e => errors.push(e.message));
  await ph.goto(URL); await ph.waitForFunction(() => window.__t);
  await ph.evaluate(async orig => { await __t.Data.addItem({kind: 'midi', title: 'Mi canción con un nombre bastante largo', bpm: 120, notas: orig}); __t.goLearn(); }, orig); await sleep(200);
  const pid = await ph.evaluate(() => __t.Data.items[0].id);
  await ph.click(`[data-oct="${pid}"]`); await sleep(150);
  const fits = await ph.evaluate(() => { const el = document.querySelector('.oct-row'), sl = document.getElementById('songList'); return [el.getBoundingClientRect().right, innerWidth, sl.scrollWidth, sl.clientWidth]; });
  ok(fits[0] <= fits[1] + 1 && fits[2] <= fits[3] + 1, 'en un celular el panel cabe sin desplazar hacia los lados', fits);
  await ph.screenshot({path: path.join(SHOTS, 'octava-celular.png')});

  ok(errors.length === 0, 'sin errores en la página', errors);
  await browser.close(); server.close();
  console.log(`\n${pass} bien, ${failN} mal. Capturas en ${SHOTS}`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
