/*
 * Optional sync of all planners to one JSON file in a secret GitHub Gist,
 * using the GitHub Gists API straight from the browser. The token stays in this
 * browser's localStorage and is only ever sent to api.github.com.
 */
(function (root) {
  'use strict';
  var KEY = 'homeBuyingPlanner.sync';
  var API = 'https://api.github.com';

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function hash(str) { // FNV-1a, enough to notice local changes
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h.toString(16);
  }

  /**
   * opts: {
   *   getPlanners(): array            current local planners
   *   applyRemote(planners): void     replace local planners with the remote copy
   *   canApplyRemote(): bool          false while there are unsaved edits on screen
   *   onStatus(state, detail): void   'off' | 'syncing' | 'synced' | 'error' | 'conflict'
   *   resolveConflict(): Promise<'remote'|'local'|null>
   *   payload(planners): string       file contents to write
   * }
   */
  function create(opts) {
    var cfg = loadCfg();
    var pushTimer = null, busy = false, again = false, lastPullAt = 0;

    function loadCfg() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
    function saveCfg() { try { if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
    function status(s, d) { opts.onStatus(s, d); }
    function localHash() { return hash(JSON.stringify(opts.getPlanners())); }

    function req(method, path, body, token) {
      var c = token ? { token: token } : cfg;
      return fetch(API + path, {
        method: method,
        headers: Object.assign({ 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + c.token, 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* ignore */ }
          return { status: r.status, ok: r.ok, json: j };
        });
      });
    }
    var FILE = 'home-planner-data.json';
    function errText(r, what) {
      if (r.status === 401) return 'GitHub rejected the token (expired or wrong). Connect again in Data → Sync.';
      if (r.status === 403) return 'The token is not allowed to ' + what + '. It needs the "gist" permission.';
      if (r.status === 404) return 'The gist was not found, or the token cannot see it.';
      return 'GitHub error ' + r.status + (r.json && r.json.message ? ': ' + r.json.message : '');
    }
    function findGist(token) {
      return req('GET', '/gists?per_page=100', null, token).then(function (r) {
        if (!r.ok) throw new Error(errText(r, 'list your gists'));
        var g = (r.json || []).find(function (x) { return x.files && x.files[FILE]; });
        return g ? g.id : null;
      });
    }

    /** Check a token. Resolves {ok, message, login, gistId}. */
    function test(c) {
      return req('GET', '/user', null, c.token).then(function (r) {
        if (!r.ok) return { ok: false, message: errText(r, 'read your account') };
        var login = r.json && r.json.login;
        if (c.gistId) return { ok: true, login: login, gistId: c.gistId };
        return findGist(c.token).then(function (id) { return { ok: true, login: login, gistId: id }; });
      }).catch(function (e) { return { ok: false, message: e && e.message ? e.message : 'Could not reach GitHub. Check your connection.' }; });
    }

    function readRemote() {
      if (!cfg.gistId) return Promise.resolve({ exists: false });
      return req('GET', '/gists/' + encodeURIComponent(cfg.gistId)).then(function (r) {
        if (!r.ok) throw new Error(errText(r, 'read the gist'));
        var f = r.json.files && r.json.files[FILE];
        if (!f) return { exists: false, gist: true };
        var p = f.truncated ? fetch(f.raw_url, { cache: 'no-store' }).then(function (x) { return x.text(); }) : Promise.resolve(f.content);
        return p.then(function (text) {
          var data;
          try { data = JSON.parse(text); } catch (e) { throw new Error('The gist does not contain valid planner JSON.'); }
          if (!data || !Array.isArray(data.planners)) throw new Error('The gist is not a Home Buying Planner file.');
          var v = r.json.history && r.json.history[0] ? r.json.history[0].version : r.json.updated_at;
          return { exists: true, sha: v, planners: data.planners };
        });
      });
    }
    function writeRemote(sha) {
      var planners = opts.getPlanners();
      var files = {}; files[FILE] = { content: opts.payload(planners) };
      var check = sha && cfg.gistId ? readRemote().then(function (cur) { return cur.exists && cur.sha !== sha; }) : Promise.resolve(false);
      return check.then(function (changed) {
        if (changed) return { conflict: true };
        var call = cfg.gistId
          ? req('PATCH', '/gists/' + encodeURIComponent(cfg.gistId), { files: files })
          : req('POST', '/gists', { description: 'Home Buying Planner data (secret gist: anyone with the link can read it)', public: false, files: files });
        return call.then(function (r) {
          if (!r.ok) throw new Error(errText(r, 'write the gist'));
          cfg.gistId = r.json.id;
          cfg.sha = r.json.history && r.json.history[0] ? r.json.history[0].version : r.json.updated_at;
          cfg.syncedHash = hash(JSON.stringify(planners)); cfg.syncedAt = new Date().toISOString(); saveCfg();
          return { ok: true };
        });
      });
    }

    /** Full reconcile: pull if remote changed, push if local changed, ask on conflict. */
    function sync(reason) {
      if (!cfg) { status('off'); return Promise.resolve(); }
      if (busy) { again = true; return Promise.resolve(); }
      busy = true; status('syncing');
      lastPullAt = Date.now();
      return readRemote().then(function (remote) {
        var localChanged = localHash() !== cfg.syncedHash;
        if (!remote.exists) return writeRemote(null);
        if (remote.sha === cfg.sha) return localChanged ? writeRemote(cfg.sha) : { ok: true };
        // remote changed elsewhere
        var remoteHash = hash(JSON.stringify(remote.planners));
        if (remoteHash === localHash()) { cfg.sha = remote.sha; cfg.syncedHash = remoteHash; saveCfg(); return { ok: true }; }
        if (!localChanged || !cfg.sha) {
          if (!cfg.sha && opts.getPlanners().length && localChanged) return conflict(remote);
          if (!opts.canApplyRemote()) { again = false; return { deferred: true }; }
          opts.applyRemote(remote.planners);
          cfg.sha = remote.sha; cfg.syncedHash = localHash(); cfg.syncedAt = new Date().toISOString(); saveCfg();
          return { pulled: true };
        }
        return conflict(remote);
      }).then(function (res) {
        if (res && res.conflict) return readRemote().then(conflict);
        return res;
      }).then(function (res) {
        busy = false;
        status(res && res.deferred ? 'pending' : 'synced', cfg && cfg.syncedAt);
        if (again) { again = false; schedulePush(500); }
        return res;
      }, function (err) {
        busy = false;
        status('error', err && err.message ? err.message : 'Could not reach GitHub.');
      });
      void reason;
    }
    function conflict(remote) {
      status('conflict');
      return opts.resolveConflict().then(function (choice) {
        if (choice === 'remote') {
          opts.applyRemote(remote.planners);
          cfg.sha = remote.sha; cfg.syncedHash = localHash(); cfg.syncedAt = new Date().toISOString(); saveCfg();
          return { pulled: true };
        }
        if (choice === 'local') return writeRemote(remote.sha);
        return { deferred: true };
      });
    }
    function schedulePush(ms) {
      if (!cfg || cfg.auto === false) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(function () { if (localHash() !== cfg.syncedHash) sync('change'); }, ms == null ? 2500 : ms);
    }
    function maybePull() { if (cfg && Date.now() - lastPullAt > 20000) sync('focus'); }

    return {
      configured: function () { return !!cfg; },
      config: function () { return cfg ? { login: cfg.login, gistId: cfg.gistId, auto: cfg.auto !== false, syncedAt: cfg.syncedAt } : null; },
      test: test,
      connect: function (c) { cfg = { login: c.login, gistId: c.gistId || null, token: c.token, auto: true, sha: null, syncedHash: null }; saveCfg(); return sync('connect'); },
      disconnect: function () { cfg = null; saveCfg(); status('off'); },
      setAuto: function (v) { if (cfg) { cfg.auto = !!v; saveCfg(); } },
      sync: sync, schedulePush: schedulePush, maybePull: maybePull,
      unsynced: function () { return !!cfg && localHash() !== cfg.syncedHash; }
    };
  }

  root.HBPSync = { create: create, hash: hash, FILE: 'home-planner-data.json', _b64encode: b64encode, _b64decode: b64decode };
})(this);
