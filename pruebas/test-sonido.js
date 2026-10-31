// Sonido de piano grabado (Salamander Grand Piano): carga, afinación de cada grabación, mezcla de fuerzas, soltar y pedal,
// respaldo con el sonido sencillo si no carga, y que quede guardado para la siguiente visita.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {Piano, voices, startVoice, releaseVoice, setPedal, PIANO_KEYS, PIANO_TUNE, get actx(){ return actx; }, goFree, press, release, openSettings: () => $('#dlg') };\nNube.bind();`;
  return h.replace('Nube.bind();', hook);
}
let blockSound = false, soundHits = 0;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  const m = u.match(/^\/piano\/sonido\/(\d+[pf]\.mp3)$/);
  if (m && !blockSound && fs.existsSync(path.join(REPO, 'sonido', m[1]))){
    soundHits++;
    res.writeHead(200, {'content-type': 'audio/mpeg', 'cache-control': 'no-store'});
    return res.end(fs.readFileSync(path.join(REPO, 'sonido', m[1])));
  }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(Object.assign({args: ['--autoplay-policy=no-user-gesture-required']}, process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {}));
  const errors = [];
  async function open(ctx){
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    return page;
  }
  async function newCtx(){
    const ctx = await browser.newContext({viewport: {width: 1180, height: 760}});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(() => { if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify({device: 'tab-h'})); sessionStorage.setItem('piano:sin-cuenta', '1'); });
    return ctx;
  }

  console.log('1. Archivos');
  const files = fs.readdirSync(path.join(REPO, 'sonido')).filter(f => f.endsWith('.mp3'));
  ok(files.length === 60, '60 grabaciones (30 notas en suave y fuerte)', files.length);
  const size = files.reduce((a, f) => a + fs.statSync(path.join(REPO, 'sonido', f)).size, 0);
  ok(size < 3.5e6, 'pesan menos de 3,5 MB en total', size);
  ok(fs.existsSync(path.join(REPO, 'sonido', 'LEEME.md')), 'hay una nota con el autor y la licencia');

  console.log('2. Carga con el primer toque');
  const ctxA = await newCtx();
  const A = await open(ctxA);
  ok((await A.evaluate(() => __t.Piano.state)) === '', 'antes de tocar nada no se descarga');
  await A.evaluate(() => __t.goFree()); await sleep(200);
  const key = await A.$('#keys .key.white'); const bb = await key.boundingBox();
  await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * 0.8); await A.mouse.down(); await sleep(120); await A.mouse.up();
  await A.waitForFunction(() => __t.Piano.state === 'listo' || __t.Piano.state === 'error', null, {timeout: 60000});
  ok((await A.evaluate(() => __t.Piano.state)) === 'listo', 'carga completa', await A.evaluate(() => ({s: __t.Piano.state, f: __t.Piano.fails})));
  ok((await A.evaluate(() => __t.Piano.buf.size)) === 60, 'las 60 grabaciones quedan listas');
  ok(soundHits === 60, 'cada archivo se pidió una sola vez', soundHits);

  console.log('3. Cada grabación está en su nota (afinación medida)');
  const tun = await A.evaluate(() => {
    const out = [];
    for (let i = 0; i < __t.PIANO_KEYS.length; i++){
      const k = __t.PIANO_KEYS[i];
      if (k < 33 || k > 99) continue;   // los extremos son difíciles de medir con este método
      for (const t of ['f', 'p']){
        const b = __t.Piano.buf.get(k + t), d = b.getChannelData(0), sr = b.sampleRate;
        const st = Math.round((__t.Piano.start.get(k + t) + 0.12) * sr), n = Math.min(Math.round(sr * 0.25), d.length - st - 4000);
        const f0 = 440 * Math.pow(2, (k - 69) / 12) * Math.pow(2, -__t.PIANO_TUNE[i] / 1200);  // tono natural de la grabación
        // Autocorrelación normalizada alrededor del período esperado (±1 semitono): busca el mejor período.
        let best = 0, bestLag = 0;
        const lo = Math.floor(sr / (f0 * 1.06)), hi = Math.ceil(sr / (f0 / 1.06));
        for (let lag = lo; lag <= hi; lag++){
          let s = 0, e1 = 0, e2 = 0;
          for (let j = st; j < st + n; j++){ s += d[j] * d[j + lag]; e1 += d[j] * d[j]; e2 += d[j + lag] * d[j + lag]; }
          const r = s / Math.sqrt(e1 * e2 + 1e-12);
          if (r > best){ best = r; bestLag = lag; }
        }
        // interpolación parabólica para afinar el período
        const R = lag => { let s = 0, e1 = 0, e2 = 0; for (let j = st; j < st + n; j++){ s += d[j] * d[j + lag]; e1 += d[j] * d[j]; e2 += d[j + lag] * d[j + lag]; } return s / Math.sqrt(e1 * e2 + 1e-12); };
        const a = R(bestLag - 1), c = R(bestLag + 1), sh = (a - c) / (2 * (a - 2 * best + c) || 1);
        const f = sr / (bestLag + sh);
        out.push({k, t, cents: Math.round(1200 * Math.log2(f / f0)), r: +best.toFixed(2)});
      }
    }
    return out;
  });
  console.log('     centésimas medidas: ' + tun.map(x => x.k + x.t + ':' + x.cents).join(' '));
  const bad = tun.filter(x => Math.abs(x.cents) > 30 || x.r < 0.8);
  ok(tun.length >= 44 && bad.length === 0, 'el tono medido coincide con la nota (±30 centésimas) en ' + tun.length + ' grabaciones', bad);

  console.log('4. Inicio y volumen');
  const st = await A.evaluate(() => [...__t.Piano.start.values()]);
  ok(st.every(x => x >= 0 && x < 0.08), 'el silencio inicial que se salta es corto (menos de 80 ms)', Math.max(...st));
  const lv = await A.evaluate(() => { const peak = b => { const d = b.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; };
    return {f: peak(__t.Piano.buf.get('60f')), p: peak(__t.Piano.buf.get('60p'))}; });
  ok(lv.f > 0.3 && lv.f <= 1 && lv.p < lv.f * 0.8, 'la grabación fuerte suena más que la suave, sin saturar', lv);

  console.log('5. Tocar: grabación, tono y mezcla de fuerzas');
  const v1 = await A.evaluate(() => { __t.startVoice(61, 0.98); const v = __t.voices.get(61);
    return {n: v.srcs.length, type: v.srcs[0].constructor.name, rate: v.srcs[0].playbackRate.value, buf: v.srcs[0].buffer === __t.Piano.buf.get('60f')}; });
  const exp61 = Math.pow(2, 1 / 12 + __t_tune(13) / 1200);
  function __t_tune(i){ return [10,13,11,-3,-9,-9,-11,-7,-4,0,-6,-3,-3,-6,-3,0,-4,-8,-8,-5,-7,-8,-12,-13,-12,-17,-17,-27,-38,-38][i]; }
  ok(v1.type === 'AudioBufferSourceNode' && v1.n === 1 && v1.buf, 'Do♯ central fuerte usa la grabación fuerte de Do central', v1);
  ok(Math.abs(v1.rate - exp61) < 1e-4, 'y la sube un semitono (con su corrección de afinación)', [v1.rate, exp61]);
  const v2 = await A.evaluate(() => { __t.startVoice(59, 0.42); const v = __t.voices.get(59); return {n: v.srcs.length, buf: v.srcs[0].buffer === __t.Piano.buf.get('60p')}; });
  ok(v2.n === 1 && v2.buf, 'una nota suave usa solo la grabación suave', v2);
  const v3 = await A.evaluate(() => { __t.startVoice(64, 0.7); return __t.voices.get(64).srcs.length; });
  ok(v3 === 2, 'una fuerza media mezcla las dos grabaciones', v3);
  await A.evaluate(() => { __t.startVoice(36, 0.8); __t.startVoice(96, 0.8); __t.startVoice(21, 0.8); __t.startVoice(108, 0.8); });
  ok(await A.evaluate(() => [36, 96, 21, 108].every(m => __t.voices.get(m)?.srcs[0].constructor.name === 'AudioBufferSourceNode')), 'suenan grabadas de la tecla más grave a la más aguda del piano');

  console.log('6. Soltar y pedal');
  await A.evaluate(() => { for (const m of [...__t.voices.keys()]) __t.releaseVoice(m); });
  ok((await A.evaluate(() => __t.voices.size)) === 0, 'al soltar las teclas se apagan');
  await A.evaluate(() => { __t.startVoice(60, 0.8); __t.setPedal('btn', true); __t.releaseVoice(60); });
  ok((await A.evaluate(() => __t.voices.has(60))), 'con el pedal la nota sigue sonando al soltar');
  await A.evaluate(() => __t.setPedal('btn', false));
  ok(!(await A.evaluate(() => __t.voices.has(60))), 'al quitar el pedal se apaga');
  await A.evaluate(() => { for (let m = 40; m < 75; m++) __t.startVoice(m, 0.8); });
  ok((await A.evaluate(() => __t.voices.size)) <= 28, 'no suenan más de 28 notas a la vez', await A.evaluate(() => __t.voices.size));
  await A.evaluate(() => { for (const m of [...__t.voices.keys()]) __t.releaseVoice(m); });
  await A.evaluate(() => { __t.startVoice(60, 0.8); }); await sleep(5600);
  ok(!(await A.evaluate(() => __t.voices.has(60))), 'una nota que se deja sonar termina sola y libera su lugar');

  console.log('7. Ajustes');
  await A.evaluate(() => document.getElementById('btnSettings')?.click()); await sleep(200);
  const txt = await A.evaluate(() => document.getElementById('sndState').textContent + ' | ' + document.getElementById('sndState').nextElementSibling.textContent);
  ok(/listo/.test(txt) && /Alexander Holm/.test(txt) && /Atribución 3\.0/.test(txt), 'Ajustes muestra el estado y el crédito', txt);

  console.log('8. Segunda visita: sale de lo guardado');
  blockSound = true; soundHits = 0;
  const A2 = await open(ctxA);
  await A2.evaluate(() => __t.goFree()); await sleep(200);
  await A2.mouse.click(600, 700);
  await A2.waitForFunction(() => __t.Piano.state === 'listo' || __t.Piano.state === 'error', null, {timeout: 60000});
  ok((await A2.evaluate(() => __t.Piano.state)) === 'listo' && soundHits === 0, 'carga sin pedir nada al servidor (funciona sin conexión)', [await A2.evaluate(() => __t.Piano.state), soundHits]);

  console.log('9. Sin conexión la primera vez');
  const ctxB = await newCtx();
  const B = await open(ctxB);
  await B.evaluate(() => __t.goFree()); await sleep(200);
  await B.mouse.click(600, 700);
  await B.waitForFunction(() => __t.Piano.state === 'listo' || __t.Piano.state === 'error', null, {timeout: 60000});
  ok((await B.evaluate(() => __t.Piano.state)) === 'error', 'avisa que no cargó');
  const vb = await B.evaluate(() => { __t.startVoice(60, 0.8); const v = __t.voices.get(60); return v && v.srcs[0].constructor.name; });
  ok(vb === 'OscillatorNode', 'y suena con el sonido sencillo en vez de quedar mudo', vb);
  await B.evaluate(() => document.getElementById('btnSettings')?.click()); await sleep(200);
  ok(/No se pudo cargar/.test(await B.evaluate(() => document.getElementById('sndState').textContent)), 'Ajustes lo explica');

  ok(errors.length === 0, 'sin errores en la página', errors);
  await browser.close(); server.close();
  console.log(`\n${pass} bien, ${failN} mal`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
