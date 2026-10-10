// «Crear canción» en Tocar libre: grabar por tramos, corregir un tramo, escuchar, guardar en «Tus canciones» y practicar.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, Data, settings, mk, Mk, press, release, goFree, goLearn, goHome, openSong, start, step, setMode,
    pendingGroup, songData, songLevels, curLevel, mkTramo, mkFlat, get autoN(){ return autoCount.size; }, get saved(){ return saved; }};\nNube.bind();`;
  return h.replace('Nube.bind();', hook);
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
  async function open(viewport, dev, ctx){
    ctx = ctx || await browser.newContext({viewport});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(dev => {
      if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify({device: dev}));
      // Reloj que la prueba adelanta a mano: así un tramo «dura» lo que la prueba diga.
      let now = 1000; performance.now = () => now; window.__tick = ms => { now += ms; };
    }, dev);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    return page;
  }
  // Cada evento es [ms que pasan antes, nota, true = apretar / false = soltar].
  const events = (page, evs) => page.evaluate(evs => { for (const [dt, m, on] of evs){ __tick(dt); if (on) __t.press(m, 'midi', 0.7); else __t.release(m); } }, evs);
  const txt = (page, sel) => page.evaluate(sel => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim(), sel);
  const acts = page => page.evaluate(() => [...document.querySelectorAll('#mkAct [data-mk]')].map(b => b.dataset.mk + ':' + b.textContent.trim()));
  const chips = page => page.evaluate(() => [...document.querySelectorAll('#mkChips .chip')].map(b => b.textContent.trim()));
  const draft = page => page.evaluate(() => JSON.parse(JSON.stringify(__t.mk)));

  console.log('1. El botón y el panel');
  const A = await open({width: 1180, height: 760}, 'tab-h');
  await A.evaluate(() => __t.goFree()); await sleep(100);
  ok(await A.isVisible('#btnMaker') && (await txt(A, '#btnMaker')) === 'Crear canción', 'en Tocar libre hay un botón «Crear canción»');
  ok(await A.isHidden('#maker'), 'el panel empieza cerrado');
  ok(await A.isVisible('#btnRec') && await A.isVisible('#btnPlayRec'), 'la grabación rápida de siempre sigue ahí');
  await A.click('#btnMaker');
  ok(await A.isVisible('#maker') && (await A.getAttribute('#btnMaker', 'aria-pressed')) === 'true', 'al tocarlo se abre el panel');
  ok(await A.isHidden('#btnRec') && await A.isHidden('#btnPlayRec'), 'con el panel abierto se ocultan Grabar y Escuchar de la grabación rápida');
  ok(/Graba un pedazo/.test(await txt(A, '#mkStatus')), 'sin tramos explica qué hacer', await txt(A, '#mkStatus'));
  ok(JSON.stringify(await acts(A)) === JSON.stringify(['rec:Grabar tramo 1']), 'solo ofrece «Grabar tramo 1»', await acts(A));
  ok(await A.isHidden('#mkChips'), 'todavía no hay lista de tramos');

  console.log('\n2. Grabar el primer tramo');
  await A.click('[data-mk="rec"]');
  ok(/Grabando el tramo 1\. Empieza cuando quieras/.test(await txt(A, '#mkStatus')), 'espera a la primera nota', await txt(A, '#mkStatus'));
  ok(JSON.stringify((await acts(A)).map(a => a.split(':')[0])) === JSON.stringify(['stop', 'cancel']), 'mientras graba ofrece Detener y Descartar', await acts(A));
  // Tres segundos sin tocar (no cuentan), luego Do Re Mi con medio segundo cada una.
  await events(A, [[3000, 60, true], [400, 60, false], [100, 62, true], [400, 62, false], [100, 64, true], [900, 64, false]]);
  ok(/Grabando el tramo 1: 0:01, 3 notas/.test(await txt(A, '#mkStatus')), 'cuenta el tiempo desde la primera nota y las notas tocadas', await txt(A, '#mkStatus'));
  await A.evaluate(() => __tick(1500));
  await A.click('[data-mk="stop"]');
  let d = await draft(A);
  ok(d.tramos.length === 1 && JSON.stringify(d.tramos[0].n) === JSON.stringify([[60, 0, 400], [62, 500, 400], [64, 1000, 900]]), 'el tramo guarda las tres notas, desde cero y con su duración', d.tramos[0]);
  ok(d.tramos[0].len === 1900, 'el tramo termina con su última nota: no cuenta el silencio antes de detener', d.tramos[0].len);
  ok(JSON.stringify(await chips(A)) === JSON.stringify(['Tramo 1 · 3 notas']), 'aparece la ficha «Tramo 1 · 3 notas»', await chips(A));
  ok(/1 tramo, 3 notas, 0:01\. Todavía no está guardada/.test(await txt(A, '#mkStatus')), 'el resumen dice que aún no está guardada', await txt(A, '#mkStatus'));
  ok(JSON.stringify((await acts(A)).map(a => a.split(':')[0])) === JSON.stringify(['rec', 'play', 'save', 'new']), 'ahora ofrece grabar otro tramo, escuchar todo, guardar y empezar otra', await acts(A));
  ok((await acts(A))[0] === 'rec:Grabar tramo 2', 'el siguiente es el tramo 2');

  console.log('\n3. Acordes, pausas largas y teclas que quedan apretadas');
  await A.click('[data-mk="rec"]');
  // Acorde Do-Mi-Sol con los dedos cayendo a 20 y 45 ms; una pausa de 6 s buscando la tecla; una nota que no se suelta.
  await events(A, [[500, 48, true], [20, 52, true], [25, 55, true], [600, 48, false], [0, 52, false], [0, 55, false], [6000, 65, true], [300, 65, false], [200, 67, true]]);
  await A.evaluate(() => __tick(700));
  await A.click('[data-mk="stop"]');
  d = await draft(A);
  const t2 = d.tramos[1].n;
  ok(t2.slice(0, 3).every(n => n[1] === 0), 'las tres notas del acorde empiezan juntas', t2);
  ok(t2.slice(0, 3).every(n => n[2] === 645), 'y terminan donde se soltaron', t2.slice(0, 3));
  ok(t2[3][0] === 65 && t2[3][1] === 645 + 2000, 'la pausa de seis segundos queda en dos', t2[3]);
  ok(t2[4][0] === 67 && t2[4][2] === 700, 'la nota que seguía apretada se cierra al detener', t2[4]);
  await A.evaluate(() => __t.release(67));
  ok((await draft(A)).tramos.length === 2, 'soltarla después no agrega nada');

  console.log('\n4. Un tramo vacío y un tramo descartado');
  await A.click('[data-mk="rec"]'); await A.evaluate(() => __tick(2000)); await A.click('[data-mk="stop"]');
  ok((await draft(A)).tramos.length === 2 && /no se grabó ninguna nota/.test(await txt(A, '#mkStatus')), 'detener sin haber tocado no crea un tramo y lo avisa', await txt(A, '#mkStatus'));
  await A.click('[data-mk="rec"]'); await events(A, [[100, 72, true], [200, 72, false]]); await A.click('[data-mk="cancel"]');
  ok((await draft(A)).tramos.length === 2, '«Descartar» tira lo que se estaba grabando');

  console.log('\n5. Elegir un tramo: escucharlo, grabarlo de nuevo, borrarlo');
  await A.click('[data-mk="rec"]'); await events(A, [[100, 72, true], [300, 72, false], [100, 74, true], [300, 74, false]]); await A.click('[data-mk="stop"]');
  ok((await chips(A)).length === 3, 'ya son tres tramos', await chips(A));
  await A.click('#mkChips [data-tr="0"]');
  ok((await A.getAttribute('#mkChips [data-tr="0"]', 'aria-pressed')) === 'true' && /Tramo 1: 3 notas/.test(await txt(A, '#mkStatus')), 'al tocar la ficha queda elegido el tramo 1', await txt(A, '#mkStatus'));
  ok(JSON.stringify((await acts(A)).map(a => a.split(':')[0])) === JSON.stringify(['play1', 'redo', 'copy', 'left', 'right', 'del', 'back']), 'ofrece escucharlo, grabarlo de nuevo, copiarlo, moverlo, borrarlo o volver', await acts(A));
  await A.click('[data-mk="redo"]');
  ok(/Grabando el tramo 1\./.test(await txt(A, '#mkStatus')), 'grabar de nuevo graba en el mismo lugar', await txt(A, '#mkStatus'));
  await events(A, [[200, 60, true], [300, 60, false], [200, 64, true], [300, 64, false], [200, 67, true], [300, 67, false], [200, 72, true], [300, 72, false]]);
  await A.click('[data-mk="stop"]');
  d = await draft(A);
  ok(d.tramos.length === 3 && d.tramos[0].n.map(n => n[0]).join() === '60,64,67,72' && d.tramos[1].n.length === 5, 'el tramo 1 cambió y los demás siguen en su lugar', d.tramos.map(t => t.n.map(n => n[0])));
  // Grabar de nuevo y descartar deja el tramo como estaba.
  await A.click('#mkChips [data-tr="2"]'); await A.click('[data-mk="redo"]'); await events(A, [[100, 80, true], [100, 80, false]]); await A.click('[data-mk="cancel"]');
  ok((await draft(A)).tramos[2].n.map(n => n[0]).join() === '72,74', 'descartar un regrabado conserva el tramo anterior');
  // Borrar pide dos toques.
  await A.click('#mkChips [data-tr="2"]'); await A.click('[data-mk="del"]');
  ok((await draft(A)).tramos.length === 3 && /¿Borrar el tramo 3\?/.test((await acts(A)).join()), 'el primer toque en Borrar solo pregunta', await acts(A));
  await A.click('[data-mk="del"]');
  ok((await draft(A)).tramos.length === 2 && (await chips(A)).length === 2, 'el segundo toque lo borra');
  await A.click('#mkChips [data-tr="1"]'); await A.click('[data-mk="back"]');
  ok((await A.getAttribute('#mkChips [data-tr="1"]', 'aria-pressed')) === 'false' && (await acts(A))[0] === 'rec:Grabar tramo 3', '«Volver» suelta el tramo elegido');
  await A.screenshot({path: path.join(SHOTS, 'grabar-tablet.png')});

  console.log('\n6. Escuchar');
  await A.click('#mkChips [data-tr="0"]'); await A.click('[data-mk="play1"]');
  ok(/Suena el tramo 1/.test(await txt(A, '#mkStatus')) && JSON.stringify(await acts(A)) === JSON.stringify(['quiet:Parar']), 'suena el tramo elegido y se puede parar', await acts(A));
  await sleep(120);
  ok((await A.evaluate(() => __t.autoN)) === 1, 'se ilumina la tecla que suena');
  await A.click('[data-mk="quiet"]');
  ok((await A.evaluate(() => __t.autoN)) === 0 && !(await A.evaluate(() => !!__t.Mk.play)), 'al parar no queda nada sonando');
  await A.click('[data-mk="back"]'); await A.click('[data-mk="play"]');
  ok(/Suena la canción completa: va por el tramo 1 de 2/.test(await txt(A, '#mkStatus')), 'escuchar todo empieza por el tramo 1', await txt(A, '#mkStatus'));
  ok(await A.evaluate(() => document.querySelector('#mkChips [data-tr="0"]').classList.contains('now')), 'y marca la ficha del tramo que suena');
  await sleep(2400);   // el tramo 1 dura 1,7 s; con el respiro, el 2 empieza a los 2,0 s
  ok(/va por el tramo 2 de 2/.test(await txt(A, '#mkStatus')) && await A.evaluate(() => document.querySelector('#mkChips [data-tr="1"]').classList.contains('now')), 'después pasa al tramo 2', await txt(A, '#mkStatus'));
  // Empezar a grabar corta lo que suena.
  await A.click('[data-mk="quiet"]'); await A.click('[data-mk="play"]'); await sleep(60);
  await A.evaluate(() => __t.goHome()); await sleep(50);
  ok(!(await A.evaluate(() => !!__t.Mk.play)) && (await A.evaluate(() => __t.autoN)) === 0, 'salir de Tocar libre corta lo que suena');
  await A.evaluate(() => __t.goFree());
  ok(await A.isVisible('#maker') && (await chips(A)).length === 2, 'al volver, el panel sigue abierto con sus tramos');

  console.log('\n7. Guardar en «Tus canciones»');
  await A.click('[data-mk="save"]');
  ok(await A.isVisible('#impDlg') && (await txt(A, '#impTitle')) === 'Guardar canción', 'se abre la ventana «Guardar canción»');
  ok(await A.isHidden('#impPartsField') && await A.isVisible('#impSpeedField') && await A.isHidden('#impReplaceBox'), 'sin elegir parte, con velocidad y sin «reemplazar» la primera vez');
  ok((await A.inputValue('#impName')) === 'Mi canción', 'propone un nombre');
  const pressed = sel => A.evaluate(sel => { const b = document.querySelector(sel + ' [aria-pressed="true"]'); return b ? b.textContent : null; }, sel);
  ok((await pressed('#impHands')) === 'Dos manos' && (await pressed('#impLevel')) === 'Completa', 'como hay notas graves, propone dos manos y «Completa»', [await pressed('#impHands'), await pressed('#impLevel')]);
  ok((await pressed('#impSpeed')) === 'Como la grabé', 'la velocidad empieza «Como la grabé»');
  ok(/tocas 9 notas/.test(await txt(A, '#impInfo')) && /Dura 0:0[56]/.test(await txt(A, '#impInfo')) && !/pulsos por minuto/.test(await txt(A, '#impInfo')), 'avisa cuántas notas y cuánto dura, sin hablar de pulsos', await txt(A, '#impInfo'));
  await A.fill('#impName', 'Mi primera canción');
  await A.click('#impSave'); await sleep(200);
  ok((await A.evaluate(() => __t.view)) === 'player', 'al guardar abre la canción para practicarla');
  let song = await A.evaluate(() => { const s = __t.Data.items[0]; return {id: s.id, title: s.title, bpm: s.bpm, kind: s.kind, n: __t.songData(s).notes.map(n => [n.midi, n.start, n.dur, n.hand]), lv: __t.curLevel(s), P: __t.P.notes.length}; });
  ok(song.title === 'Mi primera canción' && song.kind === 'midi' && song.bpm === 120, 'queda como canción propia', song);
  ok(song.n.length === 9 && song.P === 9 && song.lv === 4, 'con todas sus notas, en dificultad «Completa»', [song.n.length, song.P, song.lv]);
  // Tramo 1: 60,64,67,72 cada 500 ms → cada pulso (1 s = 2 pulsos). Tramo 2 empieza 300 ms después del final del 1 (1800 ms).
  ok(song.n.filter(n => n[3] === 'R').slice(0, 4).map(n => n[1]).join() === '0,1,2,3', 'el tramo 1 cae en los pulsos 0, 1, 2 y 3', song.n);
  const t2s = (1800 + 300) / 500;
  ok(song.n.filter(n => n[0] < 60).length === 3 && song.n.filter(n => n[0] < 60).every(n => Math.abs(n[1] - t2s) < 0.03 && n[3] === 'L'), 'el tramo 2 empieza después del respiro, y su acorde va a la mano izquierda', song.n.filter(n => n[0] < 60));
  d = await draft(A);
  ok(d.song === song.id && d.dirty === false && d.tramos.length === 2, 'el borrador recuerda qué canción salió de él y sigue ahí');
  // Se puede practicar: en modo Esperar pide primero la primera nota.
  const first = await A.evaluate(() => { __t.setMode('esperar'); __t.start(); for (let i = 0; i < 60; i++) __t.step(1 / 60); return __t.pendingGroup().map(n => n.midi); });
  ok(JSON.stringify(first) === JSON.stringify([60]), 'al practicar, la primera nota que pide es la primera que se grabó', first);
  await A.evaluate(() => __t.goLearn()); await sleep(100);
  ok(/Mi primera canción/.test(await txt(A, '#songList')), 'aparece en la lista «Tus canciones»');
  ok(await A.isVisible('#btnFromKeys'), 'y la lista tiene un acceso «Grabarla tecla por tecla»');

  console.log('\n8. Seguir grabando después de guardar');
  await A.click('#btnFromKeys'); await sleep(100);
  ok((await A.evaluate(() => __t.view)) === 'free' && await A.isVisible('#maker'), 'el acceso de la lista abre Tocar libre con el panel');
  ok(/Guardada como «Mi primera canción»/.test(await txt(A, '#mkStatus')), 'el panel dice con qué nombre quedó guardada', await txt(A, '#mkStatus'));
  await A.click('[data-mk="rec"]'); await events(A, [[100, 76, true], [400, 76, false]]); await A.click('[data-mk="stop"]');
  ok(/Tiene cambios que «Mi primera canción» todavía no tiene/.test(await txt(A, '#mkStatus')), 'tras grabar otro tramo avisa que hay cambios sin guardar', await txt(A, '#mkStatus'));
  await A.click('[data-mk="save"]');
  ok(await A.isVisible('#impReplaceBox') && await A.isChecked('#impReplace') && /Reemplazar «Mi primera canción»/.test(await txt(A, '#impReplaceTxt')), 'ahora ofrece reemplazar la versión anterior, marcado');
  ok((await A.inputValue('#impName')) === 'Mi primera canción', 'y conserva el nombre');
  await A.click('#impSpeed [data-v="1.5"]');
  ok((await pressed('#impSpeed')) === '×1,5' && /Dura 0:0[34]/.test(await txt(A, '#impInfo')), 'al subir la velocidad, la duración baja', await txt(A, '#impInfo'));
  await A.click('#impSave'); await sleep(200);
  const after = await A.evaluate(() => __t.Data.items.map(s => ({id: s.id, title: s.title, bpm: s.bpm, n: __t.songData(s).notes.length})));
  ok(after.length === 1 && after[0].id !== song.id && after[0].n === 10 && after[0].bpm === 180, 'queda una sola canción, la nueva, con 10 notas y más rápida', after);
  ok((await draft(A)).speed === 1.5 && (await draft(A)).song === after[0].id, 'el borrador recuerda la velocidad elegida');
  // Sin reemplazar: quedan las dos.
  await A.evaluate(() => __t.goFree());
  await A.click('[data-mk="rec"]'); await events(A, [[100, 77, true], [400, 77, false]]); await A.click('[data-mk="stop"]');
  await A.click('[data-mk="save"]'); await A.uncheck('#impReplace'); await A.fill('#impName', 'Versión larga'); await A.click('#impSave'); await sleep(200);
  ok((await A.evaluate(() => __t.Data.items.map(s => s.title))).join('|') === 'Mi primera canción|Versión larga', 'desmarcando «Reemplazar» se conservan las dos');

  console.log('\n9. El borrador no se pierde');
  await A.evaluate(() => __t.goFree());
  await A.click('[data-mk="rec"]'); await events(A, [[100, 79, true], [400, 79, false], [100, 81, true]]);
  await A.evaluate(() => __t.goLearn()); await sleep(50);
  d = await draft(A);
  ok(d.tramos.length === 5 && d.tramos[4].n.map(n => n[0]).join() === '79,81' && d.dirty, 'salir de Tocar libre mientras se graba guarda ese tramo', d.tramos.map(t => t.n.length));
  const B = await open(null, 'tab-h', A.context());
  await B.evaluate(() => __t.goFree()); await B.click('#btnMaker');
  ok((await chips(B)).length === 5 && /5 tramos, 13 notas/.test(await txt(B, '#mkStatus')), 'al volver a abrir la app, los tramos siguen ahí', await txt(B, '#mkStatus'));
  await B.screenshot({path: path.join(SHOTS, 'grabar-tablet-5.png')});
  // Empezar otra: con cambios sin guardar pide dos toques.
  await B.click('[data-mk="new"]');
  ok((await draft(B)).tramos.length === 5 && /¿Borrar estos tramos y empezar otra\?/.test((await acts(B)).join()), '«Empezar otra canción» pregunta antes si hay cambios sin guardar');
  await B.click('[data-mk="new"]');
  ok((await draft(B)).tramos.length === 0 && (await acts(B))[0] === 'rec:Grabar tramo 1', 'al confirmar queda vacío');
  ok((await B.evaluate(() => __t.Data.items.length)) === 2, 'las canciones guardadas no se tocan');
  await B.close();

  console.log('\n10. Solo melodía, una mano');
  const C = await open({width: 390, height: 780}, 'cel-v');
  await C.evaluate(() => __t.goFree());
  const fit = await C.evaluate(() => [...document.querySelectorAll('#viewFree .toolbar button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().right)));
  ok(fit.length === 6 && fit.every(x => x <= 390), 'en el celular en vertical caben todos los botones de la barra, también «Crear canción»', fit);
  await C.screenshot({path: path.join(SHOTS, 'grabar-celular-cerrado.png')});
  await C.click('#btnMaker'); await C.click('[data-mk="rec"]');
  await events(C, [[100, 64, true], [300, 64, false], [100, 62, true], [300, 62, false], [100, 60, true], [300, 60, false], [100, 62, true], [300, 62, false], [100, 64, true], [600, 64, false]]);
  await C.click('[data-mk="stop"]'); await C.click('[data-mk="save"]');
  const one = [await C.evaluate(() => document.querySelector('#impHands [aria-pressed="true"]').textContent), await C.evaluate(() => document.querySelector('#impHands [data-v="2"]').disabled), await txt(C, '#impInfo')];
  ok(one[0] === 'Una mano' && one[1] === true && /tocas 5 notas/.test(one[2]), 'sin notas graves se guarda con una mano y las cinco notas', one);
  await C.screenshot({path: path.join(SHOTS, 'grabar-celular-guardar.png')});
  await C.click('#impCancel');
  ok((await C.evaluate(() => __t.Data.items.length)) === 0 && (await draft(C)).tramos.length === 1, 'cancelar no guarda nada y conserva el borrador');
  await C.screenshot({path: path.join(SHOTS, 'grabar-celular.png')});
  // La grabación rápida de siempre no se mezcla con los tramos.
  await C.click('#btnMaker');
  ok(await C.isHidden('#maker') && await C.isVisible('#btnRec'), 'al cerrar el panel vuelve la grabación rápida');
  await C.click('#btnRec'); await events(C, [[100, 60, true], [200, 60, false]]); await C.click('#btnRec');
  ok((await C.evaluate(() => __t.saved.events.length)) === 2 && (await draft(C)).tramos.length === 1, 'grabar rápido no toca el borrador de la canción');
  await C.context().close();

  console.log('\n11. Pantallas chicas');
  for (const [name, vp, dev] of [['cel-h', {width: 800, height: 380}, 'cel-h'], ['tab-v', {width: 800, height: 1180}, 'tab-v'], ['pc', {width: 1440, height: 860}, 'pc']]){
    const D = await open(vp, dev);
    await D.evaluate(() => {
      const n = []; for (let i = 0; i < 12; i++) n.push({n: [[60 + i, 0, 400], [62 + i, 500, 400]], len: 900});
      Object.assign(__t.mk, {tramos: n, dirty: true}); __t.goFree();
    });
    await D.click('#btnMaker');
    const box = await D.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect(), kb = r('#keys'), mkr = r('#maker'), act = r('#mkAct'), tb = r('#viewFree .toolbar');
      const btns = [...document.querySelectorAll('#mkAct [data-mk]')].map(b => b.getBoundingClientRect());
      return {kbTop: kb.top, kbH: kb.height, mkBottom: mkr.bottom, actBottom: act.bottom, tbTop: tb.top, vw: innerWidth, sw: document.documentElement.scrollWidth,
              btnsIn: btns.every(b => b.right <= innerWidth + 1 && b.left >= -1), chipsScroll: document.querySelector('#mkChips').scrollWidth > document.querySelector('#mkChips').clientWidth};
    });
    ok(box.sw <= box.vw + 1 && box.btnsIn, `${name}: nada se sale por los lados`, box);
    ok(box.actBottom <= box.tbTop + 1 && box.kbH > 100, `${name}: los botones del panel quedan sobre la barra y el teclado conserva su alto`, box);
    await D.screenshot({path: path.join(SHOTS, `grabar-${name}.png`)});
    await D.click('[data-mk="rec"]'); await D.screenshot({path: path.join(SHOTS, `grabar-${name}-rec.png`)});
    await D.context().close();
  }

  console.log('\n12. Copiar y mover tramos');
  const E = await open({width: 1180, height: 760}, 'tab-h');
  await E.evaluate(() => {
    // Cuatro tramos fáciles de reconocer por su primera nota: 60, 62, 64 y 65.
    Object.assign(__t.mk, {tramos: [60, 62, 64, 65].map((m, i) => ({n: [[m, 0, 300], [m + 12, 400, 300 + i * 100]], len: 700 + i * 100})), song: '', name: '', dirty: false});
    __t.goFree();
  });
  await E.click('#btnMaker');
  const orden = async () => (await draft(E)).tramos.map(t => t.n[0][0]).join();
  const sel = () => E.evaluate(() => [...document.querySelectorAll('#mkChips [data-tr]')].findIndex(b => b.getAttribute('aria-pressed') === 'true'));
  await E.click('#mkChips [data-tr="0"]');
  ok(/copiarlo, moverlo o borrarlo/.test(await txt(E, '#mkStatus')), 'al elegir un tramo dice que se puede copiar y mover', await txt(E, '#mkStatus'));
  ok(await E.isDisabled('[data-mk="left"]') && await E.isEnabled('[data-mk="right"]'), 'el primer tramo no se puede mover antes');
  await E.click('[data-mk="copy"]');
  d = await draft(E);
  ok(await orden() === '60,62,64,65,60' && JSON.stringify(d.tramos[4]) === JSON.stringify(d.tramos[0]) && d.dirty === true, 'Copiar agrega al final un tramo igual', await orden());
  ok((await sel()) === 4 && /Copia del tramo 1: quedó al final, como tramo 5/.test(await txt(E, '#mkStatus')), 'la copia queda elegida y lo avisa', await txt(E, '#mkStatus'));
  ok(await E.isDisabled('[data-mk="right"]') && await E.isEnabled('[data-mk="left"]'), 'el último tramo no se puede mover después');
  // Cambiar la copia no cambia el original: son tramos distintos.
  await E.click('[data-mk="redo"]'); await events(E, [[100, 77, true], [300, 77, false]]); await E.click('[data-mk="stop"]');
  ok(await orden() === '60,62,64,65,77', 'grabar de nuevo la copia no toca el original', await orden());
  await E.click('#mkChips [data-tr="4"]');
  await E.click('[data-mk="left"]');
  ok(await orden() === '60,62,64,77,65' && (await sel()) === 3 && /El tramo 5 ahora es el 4, y el que estaba ahí pasó a ser el 5/.test(await txt(E, '#mkStatus')), '«Mover antes» lo adelanta un lugar y sigue elegido', [await orden(), await txt(E, '#mkStatus')]);
  ok((await E.evaluate(() => document.activeElement && document.activeElement.dataset.mk)) === 'left', 'el botón sigue listo para mover otra vez');
  await E.click('[data-mk="left"]'); await E.click('[data-mk="left"]');
  ok(await orden() === '60,77,62,64,65' && (await sel()) === 1 && (await chips(E))[1] === 'Tramo 2 · 1 nota', 'con dos toques más llega al segundo lugar', [await orden(), await chips(E)]);
  await E.click('[data-mk="right"]');
  ok(await orden() === '60,62,77,64,65' && (await sel()) === 2, '«Mover después» lo atrasa un lugar', await orden());
  // Reemplazar un tramo que no gustó: el nuevo ya está a su lado, se borra el viejo.
  await E.click('#mkChips [data-tr="3"]'); await E.click('[data-mk="del"]'); await E.click('[data-mk="del"]');
  ok(await orden() === '60,62,77,65', 'se borra el tramo viejo y el nuevo queda en su lugar', await orden());
  // Al escuchar todo suena en el orden nuevo.
  await E.click('[data-mk="play"]');
  const plan = await E.evaluate(() => __t.mkFlat(-1).notes.map(n => n.m).join());
  ok(plan === '60,72,62,74,77,65,77', 'la canción completa sigue el orden nuevo', plan);
  await E.click('[data-mk="quiet"]');
  await E.screenshot({path: path.join(SHOTS, 'grabar-mover.png')});
  // Sigue ahí al recargar.
  await E.reload(); await E.waitForFunction(() => window.__t);
  ok(await orden() === '60,62,77,65', 'el orden nuevo sigue al recargar la página', await orden());
  // La copia no puede pasar el máximo de notas.
  await E.evaluate(() => {
    const n = []; for (let i = 0; i < 2500; i++) n.push([60, i * 100, 80]);
    Object.assign(__t.mk, {tramos: [{n, len: 250000}], dirty: true}); __t.goFree();
  });
  await E.click('#btnMaker'); await E.click('#mkChips [data-tr="0"]'); await E.click('[data-mk="copy"]');
  ok((await draft(E)).tramos.length === 1 && /La copia no cabe/.test(await txt(E, '#mkStatus')), 'si la copia pasa de 4000 notas, no se hace y lo dice', await txt(E, '#mkStatus'));
  await E.context().close();
  // En el celular acostado los botones del tramo elegido siguen cabiendo.
  const F = await open({width: 800, height: 380}, 'cel-h');
  await F.evaluate(() => { Object.assign(__t.mk, {tramos: [60, 62, 64].map(m => ({n: [[m, 0, 300]], len: 300})), dirty: true}); __t.goFree(); });
  await F.click('#btnMaker'); await F.click('#mkChips [data-tr="1"]');
  const fb = await F.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect(), btns = [...document.querySelectorAll('#mkAct [data-mk]')].map(b => b.getBoundingClientRect());
    const mkr = document.querySelector('#maker');
    return {n: btns.length, btnsIn: btns.every(b => b.right <= innerWidth + 1 && b.left >= -1), sw: document.documentElement.scrollWidth, vw: innerWidth, kbH: r('#keys').height,
            rows: new Set(btns.map(b => Math.round(b.top))).size, chipH: Math.round(r('#mkChips').height), actBottom: r('#mkAct').bottom, tbTop: r('#viewFree .toolbar').top};
  });
  ok(fb.n === 7 && fb.btnsIn && fb.sw <= fb.vw + 1 && fb.kbH > 100, 'celular acostado: los siete botones del tramo caben a lo ancho y el teclado conserva su alto', fb);
  ok(fb.rows === 1 && fb.chipH >= 30 && fb.actBottom <= fb.tbTop + 1, 'celular acostado: quedan en una sola fila, sin aplastar las fichas de los tramos', fb);
  await F.screenshot({path: path.join(SHOTS, 'grabar-mover-cel-h.png')});
  await F.context().close();

  await A.context().close();
  await browser.close(); server.close();
  ok(errors.length === 0, 'sin errores de JavaScript', errors);
  console.log(`\n${pass} bien, ${failN} mal. Capturas en ${SHOTS}`);
  process.exit(failN ? 1 : 0);
})();
