// Prueba con el SDK real de Firebase (los archivos de lib/), sin red: valida que las llamadas
// que hace la app son las que el SDK acepta, y que la copia sin conexión funciona.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
const CFG = "{apiKey: 'AIzaSyD-fake-key-for-offline-test-000000', authDomain: 'piano-prueba.firebaseapp.com', projectId: 'piano-prueba', appId: '1:123456789012:web:abcdef0123456789'}";
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  if (!/const NUBE_CFG = [^;]*;/.test(h)) throw new Error('falta NUBE_CFG');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = ' + CFG + ';');
  const ret = 'return {on, start, bind, push, addSong, delSong};';
  if (!h.includes(ret)) throw new Error('falta return');
  h = h.replace(ret, "return {on, start, bind, push, addSong, delSong, _open: open, _force(){ docServer = colServer = true; sync(); syncSongs(); }, _st: () => ({docServer, colServer, docPend, colPend, err, remote, C: C && [...C].map(([id, c]) => [id, c.pend]), sdk: !!fb, known})};");
  return h.replace('Nube.bind();', "window.__t = {Data, settings, teoStore, sesStore, Nube, saveTeo, saveSes, saveSettings, getSession, sesMark, sesId, TEO, dayStr};\nNube.bind();");
}
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  const m = u.match(/^\/piano\/lib\/(firebase-(app|auth|firestore)-compat\.js)$/);
  if (m){ res.writeHead(200, {'content-type': 'text/javascript'}); return res.end(fs.readFileSync(path.join(REPO, 'lib', m[1]))); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const ctx = await browser.newContext({viewport: {width: 390, height: 800}});
  await ctx.route(/^https:\/\//, r => r.abort());       // sin internet
  await ctx.addInitScript(() => {
    if (localStorage.getItem('test:seeded')) return;
    localStorage.setItem('test:seeded', '1');
    localStorage.setItem('piano:ajustes', JSON.stringify({device: 'cel-v', niveles: {'u:lreal': 3}}));
    localStorage.setItem('piano:mejores', JSON.stringify({'cinco-do': {stars: 2, pct: 80}, 'reto:nota:1': {stars: 3, pct: 12}, 'u:lreal~3': {stars: 1, pct: 33.5}}));
    localStorage.setItem('piano:mis-canciones', JSON.stringify([{id: 'lreal', kind: 'midi', title: 'Canción real', bpm: 100, notas: '60:0:24:0 62:24:24:0 64:48:24:1', created: 10, nivel: 3}]));
    localStorage.setItem('piano:teoria', JSON.stringify({pasos: {pulso: {idx: 1, ok: [0, 1]}}, dias: ['2026-10-08']}));
    localStorage.setItem('piano:sesion', JSON.stringify({dia: '', items: [], dias: ['2026-10-08'], ult: {'cinco-do': '2026-10-08'}}));
  });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { const t = m.text(); if (/ERR_FAILED|Failed to load resource|Could not reach Cloud Firestore|WebChannelConnection|@firebase\/firestore/.test(t)) logs.push(t.slice(0, 120)); else if (m.type() === 'error' || m.type() === 'warning') errors.push('console ' + m.type() + ': ' + t.slice(0, 300)); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__t);
  console.log('SDK real, sin red');
  ok(await page.waitForFunction(() => __t.Nube._st().sdk && __t.Nube._st().known, null, {timeout: 8000}).then(() => true, () => false), 'los tres archivos del SDK cargan y la sesión se resuelve', await page.evaluate(() => __t.Nube._st()));
  ok(await page.evaluate(() => firebase.SDK_VERSION) === '12.19.0', 'versión del SDK', await page.evaluate(() => firebase.SDK_VERSION));
  ok(/Sin cuenta/.test(await page.textContent('#homeAccTxt')), 'sin sesión: «Sin cuenta»');
  await page.click('#homeAcc');
  await page.fill('#accMail', 'vicen@example.com'); await page.fill('#accPass', 'secreto1');
  await page.click('#accIn');
  ok(await page.waitForFunction(() => /No hay conexión/.test(document.querySelector('#accMsg').textContent), null, {timeout: 15000}).then(() => true, () => false), 'entrar sin red: «No hay conexión a internet»', await page.textContent('#accMsg'));
  await page.screenshot({path: path.join(SHOTS, 'real-dialogo-error.png')});
  await page.fill('#accMail', '');
  await page.click('#accForgot');
  ok(/Escribe tu correo/.test(await page.textContent('#accMsg')), 'olvidé mi contraseña sin correo: mensaje claro', await page.textContent('#accMsg'));
  await page.fill('#accMail', 'a@b.co'); await page.fill('#accPass', '123'); await page.click('#accNew');
  ok(/al menos 6/.test(await page.textContent('#accMsg')), 'crear cuenta con clave corta: mensaje claro', await page.textContent('#accMsg'));
  await page.click('#accCancel');

  // Abrir una "sesión" a mano para ejercitar Firestore real (queda todo en la cola sin conexión)
  const r1 = await page.evaluate(async () => {
    try { __t.Nube._open({uid: 'usuarioPrueba', email: 'vicen@example.com'}); } catch(e){ return 'open: ' + e.message; }
    await new Promise(r => setTimeout(r, 2500));
    return __t.Nube._st();
  });
  ok(r1 && r1.remote && r1.C && r1.docServer === false, 'los dos listeners entregan la copia local (vacía) sin red', r1);
  ok(/Sin conexión|Conectando/.test(await page.textContent('#homeAccTxt')), 'estado visible mientras no hay servidor', await page.textContent('#homeAccTxt'));
  const r2 = await page.evaluate(async () => {
    __t.teoStore.pasos[__t.TEO[1].id] = {idx: 1, ok: [0, 1]};
    try { __t.Nube._force(); } catch(e){ return 'force: ' + (e.code || '') + ' ' + e.message; }
    await new Promise(r => setTimeout(r, 1200));
    return __t.Nube._st();
  });
  ok(r2 && r2.remote && r2.remote.mejores && r2.remote.mejores['u:lreal~3'] && r2.remote.mejores['u:lreal~3'].pct === 33.5 && r2.remote.mejores['reto:nota:1'].stars === 3, 'Firestore real acepta las estrellas (claves con : y ~)', r2 && r2.remote);
  ok(r2.remote.teoria && r2.remote.teoria.dias.join() === '2026-10-08' && Object.values(r2.remote.teoria.pasos).some(p => p.ok.join() === '0,1'), 'acepta teoría con arrayUnion anidado', r2.remote && r2.remote.teoria);
  ok(r2.remote.sesion && r2.remote.sesion.ult['cinco-do'] === '2026-10-08' && r2.remote.niveles['u:lreal'] === 3, 'acepta sesión y niveles', r2.remote && [r2.remote.sesion, r2.remote.niveles]);
  ok(r2.docPend === true && r2.colPend === true && JSON.stringify(r2.C) === '[["lreal",true]]', 'la canción queda en cola de subida con su id', r2.C);
  // más escrituras reales: paso de sesión, borrar clave (FieldValue.delete), borrar canción
  const r3 = await page.evaluate(async () => {
    try {
      const it = __t.getSession(); __t.sesMark(0, __t.sesId(it[0]));
      __t.Data.saveBest(__t.TEO[1].key, 3, 100); delete __t.teoStore.pasos[__t.TEO[1].id]; __t.saveTeo();
      delete __t.settings.niveles['u:lreal']; __t.settings.niveles['u:otra'] = 2; __t.saveSettings(); __t.Nube.push();
      const s = await __t.Data.addItem({kind: 'midi', title: 'Segunda', bpm: 90, notas: '60:0:24:0', nivel: 0});
      await new Promise(r => setTimeout(r, 800));
      await __t.Data.deleteItem('lreal');
      await new Promise(r => setTimeout(r, 1200));
      return Object.assign(__t.Nube._st(), {newId: s.id});
    } catch(e){ return 'ops: ' + (e.code || '') + ' ' + e.message; }
  });
  ok(r3.remote && r3.remote.sesion.dia === await page.evaluate(() => __t.dayStr(new Date())) && r3.remote.sesion.items[0].done === true, 'acepta el plan del día con un paso hecho', r3.remote && r3.remote.sesion);
  ok(r3.remote && Object.keys(r3.remote.teoria.pasos || {}).join() === 'pulso' && !('u:lreal' in r3.remote.niveles) && r3.remote.niveles['u:otra'] === 2, 'FieldValue.delete() dentro de un mapa funciona', r3.remote && [r3.remote.teoria.pasos, r3.remote.niveles]);
  ok(r3.C && r3.C.length === 1 && r3.C[0][0] === r3.newId, 'agregar y borrar canciones en Firestore real', r3.C);
  // recargar: la copia sin conexión conserva lo pendiente
  await page.reload(); await page.waitForFunction(() => window.__t && __t.Nube._st().sdk);
  const r4 = await page.evaluate(async () => { __t.Nube._open({uid: 'usuarioPrueba', email: 'vicen@example.com'}); await new Promise(r => setTimeout(r, 2500)); return __t.Nube._st(); });
  ok(r4.remote && r4.remote.mejores && r4.remote.mejores['cinco-do'] && r4.C && r4.C.length === 1 && r4.docPend, 'tras recargar, la copia sin conexión del SDK conserva lo que faltaba subir', {m: r4.remote && Object.keys(r4.remote), C: r4.C, pend: r4.docPend});
  console.log('\nRuido de red esperado:', logs.length, 'líneas');
  console.log('Errores:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
