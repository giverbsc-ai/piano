/* Doble de pruebas del SDK compat de Firebase: solo lo que usa la app.
   El "servidor" vive en el script de Playwright (binding __srv) y empuja cambios con window.__srvPush. */
(() => {
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const DEL = {__fv: 'delete'};
  const FieldValue = { delete: () => DEL, arrayUnion: (...v) => ({__fv: 'union', v}), serverTimestamp: () => ({__fv: 'ts'}) };
  function check(v, path){
    if (v === undefined) throw new Error('Unsupported field value: undefined (found in ' + path + ')');
    if (typeof v === 'function') throw new Error('Unsupported field value: function');
    if (typeof v === 'number' && !isFinite(v) && !isNaN(v)) return;
    if (Array.isArray(v)) v.forEach((x, i) => { if (Array.isArray(x)) throw new Error('Nested arrays are not supported'); if (x && x.__fv) throw new Error('FieldValue inside array'); check(x, path + '[' + i + ']'); });
    else if (isObj(v) && !v.__fv) for (const k of Object.keys(v)){ if (!k) throw new Error('Document fields must not be empty'); if (/^__.*__$/.test(k)) throw new Error('reserved field ' + k); check(v[k], path + '.' + k); }
  }
  function mergeInto(base, patch){
    const out = isObj(base) ? Object.assign({}, base) : {};
    for (const [k, v] of Object.entries(patch)){
      if (v && v.__fv === 'delete') delete out[k];
      else if (v && v.__fv === 'union'){ const cur = Array.isArray(out[k]) ? out[k].slice() : []; for (const x of v.v) if (!cur.some(y => JSON.stringify(y) === JSON.stringify(x))) cur.push(x); out[k] = cur; }
      else if (isObj(v)) out[k] = mergeInto(out[k], v);
      else out[k] = clone(v);
    }
    return out;
  }
  window.__fakeMerge = mergeInto;
  const applyMut = (state, m) => m.type === 'delete' ? undefined : m.type === 'set' ? mergeInto({}, m.data) : mergeInto(state, m.data);

  /* --- Firestore --- */
  const base = new Map();        // path -> último estado del servidor (undefined = no existe)
  const known = new Set();       // paths/colecciones ya leídos del servidor
  let pending = [];              // mutaciones sin confirmar, en orden
  const docL = new Map(), colL = new Map();   // path -> Set(listeners)
  let mutSeq = 0, uidSeq = 0;
  const online = () => !window.__offline;
  const view = path => { let s = base.get(path); for (const m of pending) if (m.path === path) s = applyMut(s, m); return s; };
  const hasPend = path => pending.some(m => m.path === path);
  const colOf = path => path.split('/').slice(0, -1).join('/');
  const later = fn => setTimeout(fn, 0);
  function docSnap(path){
    const data = view(path);
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => clone(data), metadata: {hasPendingWrites: hasPend(path), fromCache: !(known.has(path) && online())} };
  }
  function colSnap(cp){
    const ids = new Set();
    for (const p of base.keys()) if (colOf(p) === cp && base.get(p) !== undefined) ids.add(p);
    for (const m of pending) if (colOf(m.path) === cp) ids.add(m.path);
    const docs = [...ids].filter(p => view(p) !== undefined).sort().map(docSnap);
    return { docs, size: docs.length, forEach: fn => docs.forEach(fn), metadata: {hasPendingWrites: docs.some(d => d.metadata.hasPendingWrites) || pending.some(m => colOf(m.path) === cp), fromCache: !(known.has(cp) && online())} };
  }
  function fire(path){
    for (const l of docL.get(path) || []) { const s = docSnap(path); later(() => l.live && l.next(s)); }
    const cp = colOf(path);
    for (const l of colL.get(cp) || []) { const s = colSnap(cp); later(() => l.live && l.next(s)); }
  }
  const fireCol = cp => { for (const l of colL.get(cp) || []) { const s = colSnap(cp); later(() => l.live && l.next(s)); } };
  function send(m){ window.__srv({op: 'write', mut: m.id, type: m.type, path: m.path, data: m.data}).then(r => { if (r && r.error){ pending = pending.filter(x => x !== m); fire(m.path); m.rej(Object.assign(new Error(r.error), {code: r.error})); } }); }
  function mutate(type, path, data){
    if (data) check(data, path);
    return new Promise((res, rej) => {
      const m = {id: ++mutSeq, type, path, data: clone(data), res, rej, sent: false};
      pending.push(m); fire(path);
      if (online()){ m.sent = true; send(m); }
    });
  }
  window.__srvPush = msg => {
    if (msg.kind === 'doc'){
      base.set(msg.path, msg.data === null ? undefined : msg.data); known.add(msg.path);
      if (msg.ack){ const m = pending.find(x => x.id === msg.ack); if (m){ pending = pending.filter(x => x !== m); m.res(); } }
      fire(msg.path);
    } else if (msg.kind === 'col'){
      for (const p of [...base.keys()]) if (colOf(p) === msg.path) base.delete(p);
      for (const [id, d] of Object.entries(msg.docs)) base.set(msg.path + '/' + id, d);
      known.add(msg.path); fireCol(msg.path);
    }
  };
  function subscribeServer(){
    if (!online()) return;
    for (const p of docL.keys()) window.__srv({op: 'listen', kind: 'doc', path: p});
    for (const p of colL.keys()) window.__srv({op: 'listen', kind: 'col', path: p});
  }
  window.__setOffline = off => {
    window.__offline = off;
    if (off){ for (const p of docL.keys()) fire(p); for (const cp of colL.keys()) fireCol(cp); return; }
    for (const m of pending) if (!m.sent){ m.sent = true; send(m); }
    subscribeServer();
  };
  function listen(map, path, args, snapFn){
    let opts = {}, i = 0;
    if (typeof args[0] !== 'function'){ opts = args[0]; i = 1; }
    if (typeof args[i] !== 'function') throw new Error('onSnapshot: falta el callback');
    if (Object.keys(opts).some(k => k !== 'includeMetadataChanges')) throw new Error('onSnapshot: opción desconocida');
    const l = {next: args[i], error: args[i + 1], live: true};
    if (!map.has(path)) map.set(path, new Set());
    map.get(path).add(l);
    if (online()) window.__srv({op: 'listen', kind: map === docL ? 'doc' : 'col', path}).then(r => { if (r && r.error && l.live && l.error){ l.live = false; l.error(Object.assign(new Error(r.error), {code: r.error})); } });
    else { const s = snapFn(path); later(() => l.live && l.next(s)); }
    return () => { l.live = false; map.get(path).delete(l); };
  }
  const docRef = path => ({
    id: path.split('/').pop(), path,
    collection: name => colRef(path + '/' + name),
    set(data, opts){
      if (!isObj(data)) throw new Error('set() requiere un objeto');
      if (opts && Object.keys(opts).some(k => k !== 'merge' && k !== 'mergeFields')) throw new Error('set(): opción desconocida');
      return mutate(opts && opts.merge ? 'merge' : 'set', path, data);
    },
    delete: () => mutate('delete', path),
    get: () => Promise.resolve(docSnap(path)),
    onSnapshot: (...a) => listen(docL, path, a, docSnap)
  });
  const colRef = path => ({
    path,
    doc: id => { if (id !== undefined && (typeof id !== 'string' || !id || id.includes('/'))) throw new Error('id de documento inválido'); return docRef(path + '/' + (id || 'auto' + Date.now().toString(36) + (++uidSeq))); },
    onSnapshot: (...a) => listen(colL, path, a, colSnap)
  });
  const db = {
    collection: colRef,
    enablePersistence: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    clearPersistence: () => Promise.resolve(),
    waitForPendingWrites: () => new Promise(res => { const t = setInterval(() => { if (!pending.length){ clearInterval(t); res(); } }, 20); }),
    __pending: () => pending.length
  };
  const firestore = () => db;
  firestore.FieldValue = FieldValue;

  /* --- Auth --- */
  let user = null; const authL = new Set();
  try { user = JSON.parse(localStorage.getItem('fake:auth') || 'null'); } catch(e){}
  const setUser = u => { user = u; localStorage.setItem('fake:auth', JSON.stringify(u)); authL.forEach(cb => later(() => cb(user))); };
  const fail = code => Promise.reject(Object.assign(new Error(code), {code}));
  async function account(op, email, pass){
    if (!online()) return fail('auth/network-request-failed');
    const r = await window.__srv({op, email, pass});
    if (r.error) return fail(r.error);
    setUser({uid: r.uid, email}); return {user};
  }
  const authObj = {
    languageCode: null,
    get currentUser(){ return user; },
    onAuthStateChanged(cb){ authL.add(cb); later(() => cb(user)); return () => authL.delete(cb); },
    signInWithEmailAndPassword: (e, p) => account('signin', e, p),
    createUserWithEmailAndPassword: (e, p) => account('signup', e, p),
    signInWithPopup: () => account('google', 'vicen.google@example.com', ''),
    sendPasswordResetEmail: e => e ? Promise.resolve() : fail('auth/missing-email'),
    signOut(){
      // Como el SDK real: al cambiar de usuario se cierra la vista local.
      base.clear(); known.clear(); pending = [];
      setUser(null); return Promise.resolve();
    }
  };
  const auth = () => authObj;
  auth.GoogleAuthProvider = function(){};
  const apps = [];
  window.firebase = { apps, initializeApp(cfg){ if (!cfg || !cfg.apiKey || !cfg.projectId) throw new Error('config'); apps.push({options: cfg}); return apps[0]; }, app: () => apps[0], auth, firestore };
})();
