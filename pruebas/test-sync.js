// Prueba de la sincronización con dos (y tres) dispositivos simulados y un servidor de mentira.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});

/* --- servidor de mentira --- */
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
function mergeInto(base, patch){
  const out = isObj(base) ? Object.assign({}, base) : {};
  for (const [k, v] of Object.entries(patch)){
    if (v && v.__fv === 'delete') delete out[k];
    else if (v && v.__fv === 'union'){ const cur = Array.isArray(out[k]) ? out[k].slice() : []; for (const x of v.v) if (!cur.some(y => JSON.stringify(y) === JSON.stringify(x))) cur.push(x); out[k] = cur; }
    else if (isObj(v)) out[k] = mergeInto(out[k], v);
    else out[k] = JSON.parse(JSON.stringify(v));
  }
  return out;
}
const S = { docs: new Map(), subs: [], accounts: new Map(), writes: [], deny: false, uidSeq: 0 };
const colOf = p => p.split('/').slice(0, -1).join('/');
const pushTo = (page, msg) => page.evaluate(m => { if (window.__srvPush && !window.__offline) window.__srvPush(m); }, msg).catch(() => {});
async function srv(source, msg){
  const page = source.page;
  if (msg.op === 'signup'){
    if (!/^\S+@\S+\.\S+$/.test(msg.email || '')) return {error: 'auth/invalid-email'};
    if (S.accounts.has(msg.email)) return {error: 'auth/email-already-in-use'};
    if ((msg.pass || '').length < 6) return {error: 'auth/weak-password'};
    const uid = 'U' + (++S.uidSeq); S.accounts.set(msg.email, {uid, pass: msg.pass}); return {uid};
  }
  if (msg.op === 'signin'){ const a = S.accounts.get(msg.email); return a && a.pass === msg.pass ? {uid: a.uid} : {error: 'auth/invalid-credential'}; }
  if (msg.op === 'google'){ if (!S.accounts.has(msg.email)) S.accounts.set(msg.email, {uid: 'U' + (++S.uidSeq), pass: null}); return {uid: S.accounts.get(msg.email).uid}; }
  if (msg.op === 'listen'){
    if (S.deny) return {error: 'permission-denied'};
    if (!S.subs.some(s => s.page === page && s.kind === msg.kind && s.path === msg.path)) S.subs.push({page, kind: msg.kind, path: msg.path});
    if (msg.kind === 'doc') pushTo(page, {kind: 'doc', path: msg.path, data: S.docs.has(msg.path) ? S.docs.get(msg.path) : null});
    else { const docs = {}; for (const [p, d] of S.docs) if (colOf(p) === msg.path) docs[p.split('/').pop()] = d; pushTo(page, {kind: 'col', path: msg.path, docs}); }
    return {};
  }
  if (msg.op === 'write'){
    if (S.deny) return {error: 'permission-denied'};
    if (msg.type === 'delete') S.docs.delete(msg.path);
    else S.docs.set(msg.path, mergeInto(msg.type === 'set' ? {} : S.docs.get(msg.path), msg.data));
    if (JSON.stringify(S.docs.get(msg.path) || {}).length > 1000000){ S.docs.delete(msg.path); return {error: 'invalid-argument'}; }
    S.writes.push({t: Date.now(), path: msg.path, type: msg.type, data: msg.data});
    const data = S.docs.has(msg.path) ? S.docs.get(msg.path) : null;
    const targets = new Set(S.subs.filter(s => (s.kind === 'doc' && s.path === msg.path) || (s.kind === 'col' && s.path === colOf(msg.path))).map(s => s.page));
    targets.add(page);
    for (const p of targets) pushTo(p, {kind: 'doc', path: msg.path, data, ack: p === page ? msg.mut : 0});
    return {};
  }
  return {error: 'unknown'};
}

function serverEdit(pathStr, patch){
  S.docs.set(pathStr, mergeInto(S.docs.get(pathStr), patch));
  const data = S.docs.get(pathStr);
  for (const p of new Set(S.subs.filter(x => (x.kind === 'doc' && x.path === pathStr) || (x.kind === 'col' && x.path === colOf(pathStr))).map(x => x.page))) pushTo(p, {kind: 'doc', path: pathStr, data, ack: 0});
}
/* --- servidor de archivos --- */
const CFG = "{apiKey: 'k', authDomain: 'x.firebaseapp.com', projectId: 'x', appId: '1:1:web:1'}";
const CFG_RE = /const NUBE_CFG = [^;]*;/;
function appHtml(withCfg){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  if (!CFG_RE.test(h)) throw new Error('falta NUBE_CFG');
  h = h.replace(CFG_RE, 'const NUBE_CFG = ' + (withCfg ? CFG : 'null') + ';');
  const hook = "window.__t = {get view(){ return view; }, Data, settings, teoStore, sesStore, Nube, encodeNotes, saveTeo, saveSes, saveSettings, getSession, sesMark, sesId, dayStr, TEO, LESSONS, goLearn, goHome, goTheory, goFree, renderList, store, Hist};\nNube.bind();";
  if (!h.includes('Nube.bind();')) throw new Error('falta bind');
  return h.replace('Nube.bind();', hook);
}
let serveCfg = true;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml(serveCfg)); }
  if (u === '/piano/lib/firebase-app-compat.js'){ res.writeHead(200, {'content-type': 'text/javascript'}); return res.end(FAKE); }
  if (u === '/piano/img/portada.jpg'){ res.writeHead(200, {'content-type': 'image/jpeg'}); return res.end(fs.readFileSync(path.join(REPO, 'img/portada.jpg'))); }
  if (u.startsWith('/piano/lib/')){ res.writeHead(200, {'content-type': 'text/javascript'}); return res.end('/* vacío */'); }
  res.writeHead(404); res.end();
});

let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOTAS = n => Array.from({length: n}, (_, i) => `${60 + (i % 5)}:${i * 24}:24:0`).join(' ');

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  const skipWelcome = async p => { if (await p.isVisible('#welSkip')) await p.click('#welSkip'); };
  async function device(name, viewport, dev, seed, stay){
    const ctx = await browser.newContext({viewport, hasTouch: dev !== 'pc'});
    await ctx.exposeBinding('__srv', srv);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(([dev, seed]) => {
      window.__ls = {};
      const si = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){ window.__ls[k] = (window.__ls[k] || 0) + 1; return si.call(this, k, v); };
      if (localStorage.getItem('test:seeded')) return;
      localStorage.setItem('test:seeded', '1');
      localStorage.setItem('piano:ajustes', JSON.stringify(Object.assign({device: dev}, seed.ajustes || {})));
      for (const [k, v] of Object.entries(seed.store || {})) localStorage.setItem(k, JSON.stringify(v));
    }, [dev, seed || {}]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__t);
    if (!stay) await skipWelcome(page);
    return page;
  }
  const prog = p => p.evaluate(() => __t.Data.progress);
  const titles = p => p.evaluate(() => __t.Data.items.map(s => s.title));
  const waitFor = (p, fn, arg, t = 4000) => p.waitForFunction(fn, arg, {timeout: t}).then(() => true, () => false);
  const signIn = async (p, mail, pw, create) => {
    await p.click('#homeAcc');
    await p.fill('#accMail', mail); await p.fill('#accPass', pw);
    await p.click(create ? '#accNew' : '#accIn');
  };
  const homeTxt = p => p.textContent('#homeAccTxt');
  const settled = p => waitFor(p, () => /Todo guardado/.test(document.querySelector('#homeAccTxt').textContent));

  /* ============ 0. Sin configuración: todo como antes ============ */
  console.log('0. Sin configuración de cuenta');
  serveCfg = false;
  const p0 = await device('sin-cfg', {width: 390, height: 800}, 'cel-v', {store: {'piano:mejores': {'cinco-do': {stars: 2, pct: 80}}, 'piano:mis-canciones': [{id: 'lold1', kind: 'midi', title: 'Vieja', bpm: 100, notas: NOTAS(8), created: 5}]}});
  ok(await p0.isHidden('#accRow'), 'la fila de cuenta no aparece en el inicio');
  await p0.click('#btnSettings');
  ok(await p0.isHidden('#accField'), 'Ajustes no muestra la sección Cuenta');
  await p0.click('#dlgClose');
  ok((await titles(p0)).join() === 'Vieja', 'la canción guardada antes se sigue viendo', await titles(p0));
  await p0.evaluate(() => __t.Data.addItem({kind: 'midi', title: 'Nueva local', bpm: 90, notas: '60:0:24:0 62:24:24:0', nivel: 0}));
  await p0.evaluate(() => __t.Data.saveBest('cinco-sol', 3, 100));
  await p0.reload(); await p0.waitForFunction(() => window.__t);
  ok((await titles(p0)).join() === 'Vieja,Nueva local', 'las canciones locales sobreviven a recargar', await titles(p0));
  ok((await prog(p0))['cinco-sol']?.stars === 3, 'el avance local se guarda');
  await p0.evaluate(() => { __t.settings.learnTab = 'canciones'; __t.goLearn(); });
  ok(/se guarda en este navegador\.$/.test((await p0.textContent('.sync')).trim()), 'pie de lista sin mención de cuentas', await p0.textContent('.sync'));
  await p0.context().close();
  serveCfg = true;

  /* ============ 1. Primer dispositivo entra y sube lo suyo ============ */
  console.log('1. Celular: crea la cuenta y sube lo que tenía');
  const hoy = new Date(), dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const A = await device('celular', {width: 390, height: 800}, 'cel-v', {store: {
    'piano:mejores': {'cinco-do': {stars: 2, pct: 80}, 'escala': {stars: 3, pct: 100}, 'u:lsame~3': {stars: 2, pct: 70}},
    'piano:mis-canciones': [{id: 'lsame', kind: 'midi', title: 'Cumpleaños', bpm: 100, notas: NOTAS(12), created: 10}, {id: 'lcel', kind: 'midi', title: 'Solo celular', bpm: 90, notas: NOTAS(6), created: 20}],
    'piano:teoria': {pasos: {}, dias: [dstr(ayer)]},
    'piano:sesion': {dia: '', items: [], dias: [dstr(ayer)], ult: {'cinco-do': dstr(ayer)}}
  }, ajustes: {niveles: {'u:lsame': 3}}});
  ok(/Sin cuenta/.test(await homeTxt(A)), 'el inicio avisa que no hay cuenta', await homeTxt(A));
  await A.screenshot({path: path.join(SHOTS, '1-celular-sin-cuenta.png')});
  await A.click('#homeAcc');
  await A.screenshot({path: path.join(SHOTS, '2-celular-dialogo.png')});
  await A.fill('#accMail', 'vicen@example.com'); await A.fill('#accPass', '123');
  await A.click('#accNew');
  ok(await waitFor(A, () => /al menos 6/.test(document.querySelector('#accMsg').textContent)), 'contraseña corta: mensaje claro');
  await A.fill('#accPass', 'secreto1'); await A.click('#accIn');
  ok(await waitFor(A, () => /no coinciden/.test(document.querySelector('#accMsg').textContent)), 'entrar sin cuenta creada: mensaje claro');
  await A.click('#accNew');
  ok(await settled(A), 'tras crear la cuenta queda «Todo guardado»', await homeTxt(A));
  ok(!(await A.evaluate(() => document.querySelector('#accDlg').open)), 'el diálogo se cierra al entrar');
  const uA = [...S.accounts.values()][0].uid;
  let doc = S.docs.get('usuarios/' + uA) || {};
  ok(doc.mejores && doc.mejores['escala'] && doc.mejores['escala'].stars === 3 && doc.mejores['cinco-do'].pct === 80, 'las estrellas del celular llegaron a la cuenta', doc.mejores);
  ok(doc.teoria && doc.teoria.dias.includes(dstr(ayer)) && doc.sesion.dias.includes(dstr(ayer)), 'los días de racha llegaron');
  ok(doc.sesion.ult['cinco-do'] === dstr(ayer), 'la fecha de último repaso llegó');
  ok(doc.niveles && doc.niveles['u:lsame'] === 3, 'la dificultad elegida llegó', doc.niveles);
  ok(S.docs.has(`usuarios/${uA}/canciones/lsame`) && S.docs.has(`usuarios/${uA}/canciones/lcel`), 'las dos canciones llegaron con su mismo id');
  ok((await A.evaluate(() => __t.Data.items.map(s => s.nube))).join() === '2,2', 'las canciones quedan marcadas como confirmadas');
  await A.screenshot({path: path.join(SHOTS, '3-celular-con-cuenta.png')});

  /* ============ 2. Segundo dispositivo: se combinan ============ */
  console.log('2. Tablet: entra con la misma cuenta y todo se combina');
  const B = await device('tablet', {width: 1180, height: 760}, 'tab-h', {store: {
    'piano:mejores': {'cinco-do': {stars: 3, pct: 95}, 'cinco-sol': {stars: 1, pct: 40}, 'u:ltabdup': {stars: 3, pct: 99}, 'u:ltabdup~3': {stars: 1, pct: 50}},
    'piano:mis-canciones': [{id: 'ltabdup', kind: 'midi', title: 'Cumpleaños', bpm: 100, notas: NOTAS(12), created: 11}, {id: 'ltab', kind: 'midi', title: 'Solo tablet', bpm: 80, notas: NOTAS(5), created: 30}],
    'piano:teoria': {pasos: {}, dias: [dstr(hoy)]}
  }});
  await signIn(B, 'vicen@example.com', 'mala-clave', false);
  ok(await waitFor(B, () => /no coinciden/.test(document.querySelector('#accMsg').textContent)), 'clave equivocada: mensaje claro');
  await B.fill('#accPass', 'secreto1'); await B.click('#accIn');
  ok(await settled(B), 'la tablet queda «Todo guardado»', await homeTxt(B));
  await sleep(300);
  const tb = (await titles(B)).join(), ta = (await titles(A)).join();
  ok(tb === 'Cumpleaños,Solo celular,Solo tablet', 'tablet: 3 canciones, sin duplicar «Cumpleaños»', tb);
  ok(ta === tb, 'celular: recibió en vivo la canción de la tablet', ta);
  let pa = await prog(A), pb = await prog(B);
  ok(pa['cinco-do'].stars === 3 && pb['cinco-do'].stars === 3 && pa['cinco-do'].pct === 95, 'de cada ejercicio queda la mejor marca');
  ok(pa['cinco-sol']?.stars === 1 && pb['escala']?.stars === 3, 'lo que solo tenía un dispositivo aparece en el otro');
  ok(pb['u:lsame']?.stars === 3 && pb['u:lsame~3']?.stars === 2 && !pb['u:ltabdup'], 'las estrellas de la canción duplicada pasan a la que queda', {a: pb['u:lsame'], b: pb['u:lsame~3'], c: pb['u:ltabdup']});
  ok((await B.evaluate(() => __t.teoStore.dias)).length === 2 && (await A.evaluate(() => __t.teoStore.dias)).length === 2, 'los días de teoría se suman en los dos');
  ok((await B.evaluate(() => __t.settings.niveles['u:lsame'])) === 3, 'la tablet toma la dificultad elegida en el celular');
  await B.screenshot({path: path.join(SHOTS, '4-tablet-con-cuenta.png')});

  /* ============ 3. Cambios en vivo ============ */
  console.log('3. Cambios en vivo de un dispositivo al otro');
  await B.evaluate(() => { __t.settings.learnTab = 'canciones'; __t.goLearn(); });
  await A.evaluate(() => __t.Data.addItem({kind: 'midi', title: 'Agregada en el celular', bpm: 110, notas: '60:0:24:0 64:24:24:0 67:48:24:0', nivel: 0}));
  ok(await waitFor(B, () => [...document.querySelectorAll('#songList .song .t')].some(e => e.textContent === 'Agregada en el celular')), 'canción agregada en el celular aparece en la lista abierta de la tablet');
  await B.screenshot({path: path.join(SHOTS, '5-tablet-lista.png')});
  const newKey = await A.evaluate(() => __t.Data.items.find(s => s.title === 'Agregada en el celular').key);
  await A.evaluate(k => __t.Data.saveBest(k, 2, 88), newKey);
  await A.evaluate(() => __t.Data.saveBest('arpegio', 3, 100));
  ok(await waitFor(B, k => __t.Data.progress[k]?.stars === 2 && __t.Data.progress['arpegio']?.stars === 3, newKey), 'estrellas ganadas en el celular llegan a la tablet');
  ok(await waitFor(B, () => /★★☆/.test(document.querySelector('#songList').textContent)), 'y la lista de la tablet se redibuja con las estrellas');
  await B.evaluate(() => __t.Data.saveBest('arpegio', 1, 20));
  await sleep(250);
  ok((S.docs.get('usuarios/' + uA).mejores['arpegio'].stars) === 3, 'una marca peor no reemplaza la mejor');
  // borrar en la tablet
  const delId = await B.evaluate(() => __t.Data.items.find(s => s.title === 'Solo celular').id);
  await B.evaluate(id => __t.Data.deleteItem(id), delId);
  ok(await waitFor(A, () => !__t.Data.items.some(s => s.title === 'Solo celular')), 'canción borrada en la tablet desaparece del celular');
  ok(!S.docs.has(`usuarios/${uA}/canciones/${delId}`), 'y de la cuenta');
  // teoría
  await A.evaluate(() => { const l = __t.TEO[0]; __t.teoStore.pasos[l.id] = {idx: 2, ok: [1]}; __t.saveTeo(); });
  ok(await waitFor(B, () => { const p = __t.teoStore.pasos[__t.TEO[0].id]; return p && p.idx === 2 && p.ok.join() === '1'; }), 'el punto donde quedó la lección de teoría pasa a la tablet');
  await B.evaluate(() => { const l = __t.TEO[0]; __t.teoStore.pasos[l.id] = {idx: 1, ok: [1, 3]}; __t.saveTeo(); });
  ok(await waitFor(A, () => { const p = __t.teoStore.pasos[__t.TEO[0].id]; return p && p.idx === 2 && p.ok.join() === '1,3'; }), 'los pasos aprobados en cada dispositivo se suman');
  await A.evaluate(() => { const l = __t.TEO[0]; __t.Data.saveBest(l.key, 3, 100); delete __t.teoStore.pasos[l.id]; __t.saveTeo(); });
  ok(await waitFor(B, () => !__t.teoStore.pasos[__t.TEO[0].id] && __t.Data.progress[__t.TEO[0].key]), 'lección aprobada en el celular: aprobada y sin pasos pendientes en la tablet');
  ok(!(S.docs.get('usuarios/' + uA).teoria.pasos || {})[await A.evaluate(() => __t.TEO[0].id)], 'y la cuenta ya no guarda pasos de esa lección');
  // sesión de hoy
  const sesInfo = await A.evaluate(() => { const it = __t.getSession(); __t.sesMark(0, __t.sesId(it[0])); return {n: it.length, id: __t.sesId(it[0])}; });
  ok(await waitFor(B, id => { const it = __t.sesStore.items; return __t.sesStore.dia === __t.dayStr(new Date()) && it.length && __t.sesId(it[0]) === id && it[0].done; }, sesInfo.id), 'paso hecho de la «Sesión de hoy» pasa a la tablet', sesInfo);
  await B.evaluate(() => __t.goHome());
  ok(await waitFor(B, () => /1 de \d+ pasos hechos/.test(document.querySelector('#homeHoy').textContent)), 'el inicio de la tablet muestra «1 de N pasos hechos»', await B.textContent('#homeHoy'));
  // niveles en los dos sentidos
  await B.evaluate(k => { __t.settings.niveles[k] = 5; __t.saveSettings(); __t.Nube.push(); }, newKey);
  ok(await waitFor(A, k => __t.settings.niveles[k] === 5, newKey), 'dificultad cambiada en la tablet llega al celular');
  await A.evaluate(k => { __t.settings.niveles[k] = 2; __t.saveSettings(); __t.Nube.push(); }, newKey);
  ok(await waitFor(B, k => __t.settings.niveles[k] === 2, newKey), 'y el último cambio (celular) gana en la tablet');

  /* ============ 4. Sin conexión ============ */
  console.log('4. Sin conexión en la tablet');
  await sleep(300);
  await B.evaluate(() => { Object.defineProperty(navigator, 'onLine', {get: () => !window.__offline, configurable: true}); window.__setOffline(true); window.dispatchEvent(new Event('offline')); });
  await B.evaluate(() => { __t.Data.saveBest('escala-sol', 3, 100); return __t.Data.addItem({kind: 'midi', title: 'Sin internet', bpm: 100, notas: '62:0:24:0 64:24:24:0', nivel: 0}); });
  await A.evaluate(() => __t.Data.saveBest('izquierda', 2, 75));
  await sleep(400);
  ok(/Sin conexión/.test(await homeTxt(B)), 'la tablet avisa que está sin conexión', await homeTxt(B));
  ok(!(S.docs.get('usuarios/' + uA).mejores['escala-sol']), 'nada llegó a la cuenta mientras tanto');
  ok((await titles(B)).includes('Sin internet') && (await prog(B))['escala-sol']?.stars === 3, 'pero en la tablet se sigue viendo lo hecho');
  await B.screenshot({path: path.join(SHOTS, '6-tablet-sin-conexion.png')});
  await B.evaluate(() => { window.__setOffline(false); window.dispatchEvent(new Event('online')); });
  ok(await waitFor(A, () => __t.Data.progress['escala-sol']?.stars === 3 && __t.Data.items.some(s => s.title === 'Sin internet')), 'al volver internet, lo de la tablet llega al celular');
  ok(await waitFor(B, () => __t.Data.progress['izquierda']?.stars === 2), 'y lo que hizo el celular mientras tanto llega a la tablet');
  ok(await settled(B), 'la tablet vuelve a «Todo guardado»', await homeTxt(B));

  /* ============ 5. Recargar, estabilidad ============ */
  console.log('5. Recargar y estabilidad');
  const before = S.writes.length;
  await B.reload(); await B.waitForFunction(() => window.__t);
  ok(await settled(B), 'tras recargar, la tablet sigue con la sesión abierta', await homeTxt(B));
  ok((await titles(B)).join() === (await titles(A)).join(), 'mismas canciones en los dos tras recargar', [await titles(A), await titles(B)]);
  for (let i = 0; i < 6; i++){ await A.evaluate(() => { __t.goHome(); __t.settings.learnTab = 'hoy'; __t.goLearn(); }); await B.evaluate(() => { __t.goHome(); __t.goTheory(); __t.goHome(); }); await sleep(120); }
  await sleep(800);
  ok(S.writes.length === before, 'recargar y navegar no genera escrituras de más', S.writes.slice(before).map(w => [w.path, JSON.stringify(w.data).slice(0, 160)]));
  const eq = await Promise.all([A, B].map(p => p.evaluate(() => JSON.stringify([Object.keys(__t.Data.progress).sort().map(k => [k, __t.Data.progress[k].stars, __t.Data.progress[k].pct]), __t.teoStore.dias, __t.sesStore.dias, Object.entries(__t.sesStore.ult).sort(), Object.entries(__t.settings.niveles).sort()]))));
  ok(eq[0] === eq[1], 'el avance es idéntico en los dos dispositivos');

  /* ============ 6. Tercer dispositivo limpio (computador) con Google ============ */
  console.log('6. Computador nuevo, y cierre de sesión');
  const C = await device('computador', {width: 1366, height: 768}, 'pc', {});
  await signIn(C, 'vicen@example.com', 'secreto1', false);
  ok(await settled(C), 'el computador queda «Todo guardado»');
  await sleep(200);
  ok((await titles(C)).join() === (await titles(A)).join(), 'el computador recibe todas las canciones', await titles(C));
  ok(JSON.stringify(Object.keys(await prog(C)).sort()) === JSON.stringify(Object.keys(await prog(A)).sort()), 'y todo el avance');
  const w1 = S.writes.length; await sleep(600);
  ok(S.writes.length === w1, 'un dispositivo vacío no escribe nada al entrar', S.writes.slice(w1).map(w => [w.path, JSON.stringify(w.data).slice(0, 160)]));
  await C.screenshot({path: path.join(SHOTS, '7-computador.png')});
  // cerrar sesión
  await C.click('#homeAcc');
  await C.screenshot({path: path.join(SHOTS, '8-ajustes-cuenta.png')});
  await C.click('#accOut');
  ok(/siguen guardados en tu cuenta/.test(await C.textContent('#accWarn')), 'cerrar sesión pide confirmar y explica', await C.textContent('#accWarn'));
  await C.screenshot({path: path.join(SHOTS, '9-cerrar-sesion.png')});
  await Promise.all([C.waitForEvent('load'), C.click('#accOut')]);
  await C.waitForFunction(() => window.__t);
  ok(await C.isVisible('#welSkip') && await C.isVisible('#welImg'), 'tras cerrar sesión la app se recarga y vuelve a la bienvenida');
  await skipWelcome(C);
  ok(await waitFor(C, () => /Sin cuenta/.test(document.querySelector('#homeAccTxt').textContent)), 'y al seguir sin cuenta el inicio dice «Sin cuenta»');
  ok((await titles(C)).length === 0 && Object.keys(await prog(C)).length === 0, 'el computador queda limpio');
  await sleep(300);
  ok(S.docs.has(`usuarios/${uA}/canciones/lsame`) && Object.keys(S.docs.get('usuarios/' + uA).mejores).length > 5 && (await titles(A)).length === 4, 'la cuenta y los otros dispositivos conservan todo', await titles(A));
  // otra cuenta en el mismo computador no ve nada de la primera
  await C.click('#homeAcc'); await C.click('#accGoogle');
  ok(await settled(C), 'entra con Google (otra cuenta)');
  ok((await titles(C)).length === 0 && Object.keys(await prog(C)).length === 0, 'otra cuenta empieza vacía');
  await C.evaluate(() => __t.Data.saveBest('cinco-do', 1, 30));
  await sleep(250);
  ok(S.docs.get('usuarios/' + uA).mejores['cinco-do'].stars === 3, 'lo que hace la otra cuenta no toca la primera');
  await C.context().close();

  /* ============ 7. Dispositivo que entra sin poder leer el servidor ============ */
  console.log('7. Permiso denegado por el servidor');
  S.deny = true;
  const D = await device('denegado', {width: 390, height: 800}, 'cel-v', {store: {'piano:mejores': {'cinco-do': {stars: 1, pct: 10}}, 'piano:mis-canciones': [{id: 'lden', kind: 'midi', title: 'No sube', bpm: 100, notas: NOTAS(4), created: 1}]}});
  const w2 = S.writes.length;
  // con el servidor negando, crear cuenta en el doble igual funciona (auth) pero la base no deja leer
  await signIn(D, 'vicen@example.com', 'secreto1', false);
  ok(await waitFor(D, () => /no dio permiso/.test(document.querySelector('#homeAccTxt').textContent)), 'avisa que la cuenta no dio permiso', await homeTxt(D));
  ok((await titles(D)).join() === 'No sube' && (await prog(D))['cinco-do'].stars === 1, 'lo local sigue intacto');
  ok(S.writes.length === w2, 'no se escribió nada');
  S.deny = false;
  await D.evaluate(() => window.dispatchEvent(new Event('online')));
  ok(await settled(D), 'al recuperarse, se conecta sola');
  ok(await waitFor(A, () => __t.Data.items.some(s => s.title === 'No sube')), 'y sube lo que tenía');
  ok((await prog(D))['cinco-do'].stars === 3, 'tomando la mejor marca de la cuenta');
  await D.context().close();


  /* ============ 8. Casos que encontró la revisión ============ */
  console.log('8. Casos de la revisión');
  const lsCount = (p, k) => p.evaluate(k => window.__ls[k] || 0, k);
  // 8b. dispositivo nuevo cuando el plan de la cuenta tiene una canción propia
  await A.evaluate(() => __t.goHome()); await B.evaluate(() => __t.goHome());
  const tk = await A.evaluate(() => { const s = __t.Data.items[0]; __t.getSession(); __t.sesStore.items.push({k: 'song', key: s.key, done: false}); __t.saveSes(); return s.key; });
  await sleep(300);
  const E = await device('nuevo', {width: 820, height: 1100}, 'tab-v', {});
  await signIn(E, 'vicen@example.com', 'secreto1', false);
  ok(await settled(E), 'dispositivo nuevo: llega a «Todo guardado» sin quedarse en pausa', await homeTxt(E));
  ok((await lsCount(E, 'piano:sesion')) < 25, 'sin escrituras en bucle al entrar', await lsCount(E, 'piano:sesion'));
  ok(await waitFor(E, k => __t.sesStore.items.some(it => it.key === k) && __t.sesStore.items[0].done, tk), 'y recibe el plan completo, con la canción propia');
  await E.context().close();
  // 8a. canción propia en el plan de hoy, con un paso hecho, y luego se borra
  await A.evaluate(() => __t.goHome()); await B.evaluate(() => __t.goHome());
  const planKey = await A.evaluate(k => { __t.getSession(); __t.sesStore.items.push({k: 'song', key: k, done: false}); __t.saveSes(); return k; }, newKey);
  ok(await waitFor(B, k => __t.sesStore.items.some(it => it.key === k), planKey), 'el plan con una canción propia llega a la tablet');
  let a0 = await lsCount(A, 'piano:sesion'), b0 = await lsCount(B, 'piano:sesion'), w0 = S.writes.length;
  await A.evaluate(k => __t.Data.deleteItem(__t.Data.items.find(s => s.key === k).id), planKey);
  await A.evaluate(() => __t.goHome()); await B.evaluate(() => __t.goHome());
  await sleep(1500);
  const da = await lsCount(A, 'piano:sesion') - a0, db_ = await lsCount(B, 'piano:sesion') - b0;
  ok(da < 15 && db_ < 15 && S.writes.length - w0 < 8, 'borrar una canción que está en el plan no deja la app dando vueltas', {celular: da, tablet: db_, escrituras: S.writes.length - w0});
  ok(await settled(A) && await settled(B), 'y los dos quedan en «Todo guardado»', [await homeTxt(A), await homeTxt(B)]);
  ok(!(await A.evaluate(k => __t.sesStore.items.some(it => it.key === k), planKey)) && !(await B.evaluate(k => __t.sesStore.items.some(it => it.key === k), planKey)), 'el paso de la canción borrada sale del plan en los dos');
  // 8c. importar dos veces la misma canción con la sesión abierta: quedan las dos
  const twice = await A.evaluate(async () => {
    const mk = () => __t.Data.addItem({kind: 'midi', title: 'Repetida', bpm: 100, notas: '60:0:24:0 61:24:24:0', nivel: 0});
    const a = await mk(); await new Promise(r => setTimeout(r, 300)); const b = await mk(); await new Promise(r => setTimeout(r, 300));
    return {n: __t.Data.items.filter(s => s.title === 'Repetida').length, bIn: __t.Data.items.some(s => s.key === b.key)};
  });
  ok(twice.n === 2 && twice.bIn, 'importar la misma canción dos veces deja las dos y la segunda se puede abrir', twice);
  // 8d. dificultad cambiada sin conexión, y recarga antes de que se suba
  const lk = await B.evaluate(() => __t.Data.items[0].key);
  await B.evaluate(k => { __t.settings.niveles[k] = 2; __t.saveSettings(); __t.Nube.push(); }, lk);
  await waitFor(A, k => __t.settings.niveles[k] === 2, lk);
  await settled(B);
  await B.evaluate(() => { Object.defineProperty(navigator, 'onLine', {get: () => !window.__offline, configurable: true}); window.__setOffline(true); });
  await B.evaluate(k => { __t.settings.niveles[k] = 6; __t.saveSettings(); __t.Nube.push(); }, lk);
  await sleep(150);
  await B.evaluate(k => { __t.settings.niveles[k] = 2; __t.saveSettings(); __t.Nube.push(); }, lk);
  await sleep(150);
  ok((await B.evaluate(k => __t.settings.niveles[k], lk)) === 2, 'sin conexión: volver a la dificultad anterior se respeta');
  await B.evaluate(k => { __t.settings.niveles[k] = 4; __t.saveSettings(); __t.Nube.push(); }, lk);
  await sleep(150);
  await B.reload(); await B.waitForFunction(() => window.__t);     // la cola del doble no sobrevive a recargar
  ok(await waitFor(A, k => __t.settings.niveles[k] === 4, lk), 'la dificultad elegida sin conexión no se pierde al recargar: llega al celular');
  ok((await B.evaluate(k => __t.settings.niveles[k], lk)) === 4, 'y la tablet la conserva');
  // 8e. borrar sin conexión y recargar antes de que se suba
  const rid = await B.evaluate(() => __t.Data.items.find(s => s.title === 'Repetida').id);
  await settled(B);
  await B.evaluate(() => { Object.defineProperty(navigator, 'onLine', {get: () => !window.__offline, configurable: true}); window.__setOffline(true); });
  await B.evaluate(id => __t.Data.deleteItem(id), rid);
  await sleep(150);
  await B.reload(); await B.waitForFunction(() => window.__t);
  ok(await waitFor(A, id => !__t.Data.items.some(s => s.id === id), rid), 'canción borrada sin conexión: se borra en la cuenta al volver, aunque se recargue');
  ok(!(await B.evaluate(id => __t.Data.items.some(s => s.id === id), rid)), 'y no reaparece en la tablet');
  // 8f. datos con campos que esta versión no conoce: no hay escrituras sin fin
  await settled(A); await settled(B); await sleep(300);
  const w3 = S.writes.length;
  serverEdit('usuarios/' + uA, {mejores: {'cinco-do': {extra: 1}}, teoria: {pasos: {'leccion-futura': {idx: 2, ok: [0], nota: 'x'}}}});
  await sleep(1500);
  ok(S.writes.length === w3, 'campos desconocidos en la cuenta no provocan escrituras', S.writes.slice(w3).map(w => JSON.stringify(w.data).slice(0, 120)));
  ok(S.docs.get('usuarios/' + uA).teoria.pasos['leccion-futura'].nota === 'x', 'y se respetan tal cual');
  // 8g. cuenta que nunca llegó a guardar: cerrar sesión no borra nada
  S.deny = true;
  const F = await device('sin-permiso', {width: 390, height: 800}, 'cel-v', {store: {'piano:mejores': {'cinco-do': {stars: 2, pct: 60}, 'escala': {stars: 1, pct: 30}}, 'piano:teoria': {pasos: {}, dias: [dstr(ayer)]}, 'piano:mis-canciones': [{id: 'lmia', kind: 'midi', title: 'Mía', bpm: 100, notas: NOTAS(4), created: 1}]}, ajustes: {niveles: {'u:lmia': 3}}});
  await F.click('#homeAcc'); await F.fill('#accMail', 'otra@example.com'); await F.fill('#accPass', 'secreto2'); await F.click('#accNew');
  ok(await waitFor(F, () => /no dio permiso/.test(document.querySelector('#homeAccTxt').textContent)), 'cuenta nueva sin permiso en la base: lo avisa');
  await F.click('#homeAcc'); await F.click('#accOut');
  ok(/se quedan guardadas aquí/.test(await F.textContent('#accWarn')), 'al cerrar sesión avisa que lo de aquí se queda aquí', await F.textContent('#accWarn'));
  await Promise.all([F.waitForEvent('load'), F.click('#accOut')]);
  await F.waitForFunction(() => window.__t);
  await skipWelcome(F);
  const fp = await prog(F);
  ok(fp['cinco-do']?.stars === 2 && fp['escala']?.stars === 1 && (await titles(F)).join() === 'Mía' && (await F.evaluate(() => __t.teoStore.dias.length)) === 1 && (await F.evaluate(() => __t.settings.niveles['u:lmia'])) === 3, 'no se perdió nada: estrellas, teoría, canción y dificultad siguen en el dispositivo', {fp, t: await titles(F)});
  ok(/Sin cuenta/.test(await homeTxt(F)), 'y queda sin cuenta');
  S.deny = false;
  await signIn(F, 'otra@example.com', 'secreto2', false);
  ok(await settled(F), 'cuando la cuenta ya funciona, entra y sube todo');
  const uF = S.accounts.get('otra@example.com').uid;
  ok(S.docs.get('usuarios/' + uF)?.mejores?.['cinco-do']?.stars === 2 && S.docs.has(`usuarios/${uF}/canciones/lmia`), 'lo que estaba en el dispositivo llegó a la cuenta nueva');
  await F.context().close();
  // 8h. dos pestañas: cerrar sesión en una limpia la otra
  const B2 = await B.context().newPage();
  B2.on('pageerror', e => errors.push('tablet-2: ' + e.message));
  await B2.goto(URL); await B2.waitForFunction(() => window.__t);
  ok(await settled(B2), 'segunda pestaña de la tablet: misma cuenta, todo guardado', await homeTxt(B2));
  await settled(B);
  await B.click('#homeAcc'); await B.click('#accOut');
  ok(/siguen guardados en tu cuenta/.test(await B.textContent('#accWarn')), 'tablet al día: el aviso dice que todo sigue en la cuenta', await B.textContent('#accWarn'));
  await Promise.all([B.waitForEvent('load'), B2.waitForEvent('load'), B.click('#accOut')]);
  await B.waitForFunction(() => window.__t); await B2.waitForFunction(() => window.__t);
  await sleep(400);
  ok(await B.isVisible('#welSkip'), 'la tablet vuelve a la bienvenida');
  await skipWelcome(B); await skipWelcome(B2);
  ok(/Sin cuenta/.test(await homeTxt(B2)) && (await titles(B2)).length === 0 && Object.keys(await prog(B2)).length === 0, 'la otra pestaña se recarga sola y queda limpia', [await homeTxt(B2), await titles(B2)]);
  ok(Object.keys(await B.evaluate(() => JSON.parse(localStorage.getItem('piano:mejores') || '{}'))).length === 0, 'no queda avance de la cuenta guardado en el navegador');
  ok((await titles(A)).length > 0 && Object.keys(await prog(A)).length > 5 && await settled(A), 'el celular sigue con todo');

  /* ============ 9. Pantalla de bienvenida ============ */
  console.log('9. Bienvenida');
  const W = await device('bienvenida', {width: 390, height: 800}, 'cel-v', {store: {'piano:mejores': {'cinco-do': {stars: 2, pct: 80}}}}, true);
  ok(await W.evaluate(() => __t.view) === 'welcome' && await W.isVisible('#welImg') && await W.isHidden('.cab') && await W.isHidden('.board'), 'al abrir sin cuenta aparece la portada, sin barra ni teclado');
  ok(await waitFor(W, () => { const i = document.querySelector('#welImg'); return i.complete && i.naturalWidth === 1024; }), 'la imagen carga');
  const pos = await W.evaluate(() => ['#welImg', '#accGoogle', '#welMail', '#welSkip'].map(q => Math.round(document.querySelector(q).getBoundingClientRect().top)));
  ok(pos[0] < pos[1] && pos[1] < pos[2] && pos[2] < pos[3], 'orden: imagen, registro y abajo «Seguir sin cuenta»', pos);
  ok(await W.evaluate(() => document.querySelector('#welSkip').getBoundingClientRect().bottom <= innerHeight), 'en el celular «Seguir sin cuenta» se ve sin desplazar', await W.evaluate(() => [document.querySelector('#welSkip').getBoundingClientRect().bottom, innerHeight]));
  ok(await W.isHidden('#accMail') && await W.isHidden('#accCancel'), 'los campos de correo empiezan plegados y no hay botón de cerrar');
  await W.screenshot({path: path.join(SHOTS, '10-bienvenida-celular.png')});
  await W.click('#welMail');
  ok(await W.isVisible('#accMail') && await W.isVisible('#accNew') && await W.isHidden('#welMail'), '«Usar correo y contraseña» abre los campos');
  await W.screenshot({path: path.join(SHOTS, '11-bienvenida-correo.png'), fullPage: true});
  await W.fill('#accMail', 'vicen@example.com'); await W.fill('#accPass', 'mala'); await W.click('#accIn');
  ok(await waitFor(W, () => /no coinciden/.test(document.querySelector('#accMsg').textContent)) && await W.evaluate(() => __t.view) === 'welcome', 'clave equivocada: el mensaje sale en la bienvenida');
  await W.keyboard.press('a');
  ok(await W.evaluate(() => __t.view) === 'welcome', 'escribir en los campos no toca notas ni cambia de pantalla');
  await W.fill('#accPass', 'secreto1'); await W.click('#accIn');
  ok(await waitFor(W, () => __t.view === 'home') && await settled(W), 'al entrar pasa al inicio con la cuenta abierta', await homeTxt(W));
  ok(await W.isVisible('.cab') && await W.evaluate(() => document.querySelector('#accForm').parentElement.id) === 'accDlg', 'vuelve la barra y el formulario regresa a su ventana');
  await W.reload(); await W.waitForFunction(() => window.__t);
  ok(await W.evaluate(() => __t.view) === 'home', 'con la cuenta abierta, al recargar no vuelve a pedir registro');
  await W.context().close();
  // seguir sin cuenta
  const W2 = await device('bienvenida-2', {width: 1180, height: 760}, 'tab-h', {}, true);
  await waitFor(W2, () => document.querySelector('#welImg').complete);
  await W2.screenshot({path: path.join(SHOTS, '12-bienvenida-tablet.png')});
  const box = await W2.evaluate(() => { const a = document.querySelector('#welImg').getBoundingClientRect(), b = document.querySelector('#welSlot').getBoundingClientRect(), c = document.querySelector('#welSkip').getBoundingClientRect(); return {img: [a.left, a.right, a.top, a.bottom].map(Math.round), form: [b.left, b.top].map(Math.round), skip: Math.round(c.bottom), h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth}; });
  ok(box.img[1] <= box.form[0] && box.skip <= box.h && box.img[3] <= box.h && box.sw <= box.w, 'tablet horizontal: imagen a la izquierda, registro a la derecha, todo en pantalla', box);
  await W2.click('#welSkip');
  ok(await W2.evaluate(() => __t.view) === 'home' && /Sin cuenta/.test(await homeTxt(W2)), '«Seguir sin cuenta» lleva al inicio');
  await W2.click('#homeAcc');
  ok(await W2.evaluate(() => document.querySelector('#accDlg').open) && await W2.isVisible('#accMail') && await W2.isVisible('#accCancel') && (await W2.textContent('#accTitle')) === 'Tu cuenta', 'el botón «Entrar» del inicio sigue abriendo la ventana completa');
  await W2.click('#accCancel');
  await W2.reload(); await W2.waitForFunction(() => window.__t);
  ok(await W2.evaluate(() => __t.view) === 'home', 'en la misma visita no vuelve a preguntar al recargar');
  await W2.context().close();
  // dispositivo nuevo: después de la bienvenida viene la elección de dispositivo
  const ctx3 = await browser.newContext({viewport: {width: 1366, height: 768}});
  await ctx3.exposeBinding('__srv', srv); await ctx3.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const W3 = await ctx3.newPage(); W3.on('pageerror', e => errors.push('nuevo: ' + e.message));
  await W3.goto(URL); await W3.waitForFunction(() => window.__t);
  ok(await W3.evaluate(() => __t.view) === 'welcome', 'dispositivo nuevo: primero la bienvenida');
  await waitFor(W3, () => document.querySelector('#welImg').complete);
  await W3.screenshot({path: path.join(SHOTS, '13-bienvenida-computador.png')});
  await W3.click('#welSkip');
  ok(await W3.evaluate(() => __t.view) === 'device', 'y luego la pantalla para elegir dispositivo');
  await ctx3.close();

  /* ============ 10. Historial de práctica ============ */
  console.log('10. Historial de práctica');
  const H1 = await device('hist-celular', {width: 390, height: 800}, 'cel-v', {});
  await signIn(H1, 'historial@example.com', 'secreto1', true);
  ok(await settled(H1), 'cuenta nueva para el historial');
  const H2 = await device('hist-tablet', {width: 1180, height: 760}, 'tab-h', {});
  await signIn(H2, 'historial@example.com', 'secreto1', false);
  ok(await settled(H2), 'la tablet entra a la misma cuenta');
  const uH = S.accounts.get('historial@example.com').uid, docH = () => (S.docs.get('usuarios/' + uH) || {}).historial || {};
  const hoyDe = p => p.evaluate(() => __t.Hist.total(__t.dayStr(new Date())));
  const dia = await H1.evaluate(() => __t.dayStr(new Date())), d1 = await H1.evaluate(() => __t.Hist.dev), d2 = await H2.evaluate(() => __t.Hist.dev);
  ok(d1 !== d2 && /^[a-z0-9]{8}$/.test(d1), 'cada dispositivo tiene su propia casilla', [d1, d2]);
  let wH = S.writes.length;
  await H1.evaluate(() => { for (let i = 0; i < 6; i++) __t.Hist.tick(5); });
  await sleep(350);
  ok(S.writes.length === wH && /Todo guardado/.test(await homeTxt(H1)), 'los segundos sueltos no se suben uno por uno, y el aviso sigue en «Todo guardado»', await homeTxt(H1));
  await H1.evaluate(() => __t.Hist.run(90));
  ok(await waitFor(H2, () => __t.Hist.total(__t.dayStr(new Date())).n === 1), 'al terminar una pieza en el celular, la tablet la ve');
  ok(S.writes.length === wH + 1 && JSON.stringify(docH()[dia]) === JSON.stringify({[d1]: {s: 30, n: 1, p: 90}}), 'en la cuenta queda la casilla del celular, con una sola escritura', [S.writes.length - wH, docH()]);
  await H2.evaluate(() => { for (let i = 0; i < 4; i++) __t.Hist.tick(5); __t.Hist.run(70); });
  ok(await waitFor(H1, () => { const t = __t.Hist.total(__t.dayStr(new Date())); return t.n === 2 && t.p === 160 && t.s === 50; }), 'lo de la tablet se suma en el celular sin contarse dos veces', await hoyDe(H1));
  ok(JSON.stringify(docH()[dia][d1]) === JSON.stringify({s: 30, n: 1, p: 90}) && JSON.stringify(docH()[dia][d2]) === JSON.stringify({s: 20, n: 1, p: 70}), 'cada dispositivo solo escribió su casilla', docH()[dia]);
  // Los dos practicando a la vez: no se contestan sin parar
  wH = S.writes.length;
  for (let i = 0; i < 10; i++){ await H1.evaluate(() => __t.Hist.tick(5)); await H2.evaluate(() => __t.Hist.tick(5)); await sleep(50); }
  await sleep(500);
  ok(S.writes.length === wH, 'dos dispositivos practicando a la vez no generan escrituras en cadena', S.writes.length - wH);
  await H1.evaluate(() => { __t.goFree(); __t.goHome(); });
  ok(await waitFor(H2, () => __t.Hist.total(__t.dayStr(new Date())).s === 150), 'al salir de la práctica se sube lo pendiente', await hoyDe(H2));
  await sleep(300);
  ok(S.writes.length === wH + 1 && docH()[dia][d1].s === 80 && docH()[dia][d2].s === 20, 'con una sola escritura, y la tablet no responde con otra', [S.writes.length - wH, docH()[dia]]);
  await H2.evaluate(() => { __t.goFree(); __t.goHome(); }); await sleep(300);
  ok(docH()[dia][d2].s === 70 && (await hoyDe(H1)).s === 150, 'la tablet sube lo suyo al salir', docH()[dia]);
  // Recargar no escribe; cerrar sesión no pierde lo pendiente
  wH = S.writes.length;
  await H1.reload(); await H1.waitForFunction(() => window.__t);
  ok(await settled(H1), 'el celular recarga con la sesión abierta'); await sleep(400);
  ok(S.writes.length === wH && (await hoyDe(H1)).s === 150, 'recargar no escribe nada y el historial sigue ahí', S.writes.slice(wH).map(w => JSON.stringify(w.data).slice(0, 160)));
  await H1.evaluate(() => { for (let i = 0; i < 3; i++) __t.Hist.tick(5); });
  await H1.click('#homeAcc'); await H1.click('#accOut');
  await Promise.all([H1.waitForEvent('load'), H1.click('#accOut')]);
  await H1.waitForFunction(() => window.__t);
  ok(docH()[dia][d1].s === 95, 'al cerrar sesión se suben los segundos que faltaban', docH()[dia]);
  ok(await H1.evaluate(() => __t.Hist.days().length === 0 && __t.Hist.dev) === d1, 'el celular queda sin historial, pero conserva su casilla');
  await skipWelcome(H1);
  await signIn(H1, 'historial@example.com', 'secreto1', false);
  ok(await settled(H1) && (await hoyDe(H1)).s === 165, 'al volver a entrar recupera todo', await hoyDe(H1));
  await H1.evaluate(() => { __t.Hist.tick(5); __t.Hist.run(100); });
  ok(await waitFor(H2, () => { const t = __t.Hist.total(__t.dayStr(new Date())); return t.s === 170 && t.n === 3 && t.p === 260; }), 'y sigue sumando sobre lo que ya tenía, no desde cero', [await hoyDe(H2), docH()[dia]]);
  // Datos viejos o dañados en la cuenta
  serverEdit('usuarios/' + uH, {historial: {'2020-01-01': {}, basura: {x: 1}, '2026-09-01': {[d2]: {s: 600, n: 2, p: 150, raro: 7}, 'no vale': {s: 9}}}});
  ok(await waitFor(H1, () => __t.Hist.total('2026-09-01').s === 600), 'un día que llega de la cuenta se incorpora');
  await H1.evaluate(() => __t.Hist.run(80));
  ok(await waitFor(H1, () => /Todo guardado/.test(document.querySelector('#homeAccTxt').textContent)), 'sigue «Todo guardado»'); await sleep(300);
  ok(!('basura' in docH()) && !('2020-01-01' in docH()) && docH()['2026-09-01'][d2].s === 600, 'lo dañado se limpia de la cuenta y lo bueno se respeta', Object.keys(docH()));
  wH = S.writes.length; await sleep(700);
  ok(S.writes.length === wH, 'y después no quedan escrituras repitiéndose', S.writes.slice(wH).map(w => JSON.stringify(w.data).slice(0, 200)));
  await H1.context().close(); await H2.context().close();

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos, ${S.writes.length} escrituras en total`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
