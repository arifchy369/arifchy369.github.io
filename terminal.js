/* terminal.js: the interactive terminal on the portfolio page.
   index.html loads it with <script src="/terminal.js" defer></script>. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Interactive terminal: a small shell on a virtual filesystem kept in localStorage.
  // One command registry feeds both the page terminal and the DevTools console (window.portfolio).
  var tOut = document.getElementById('term-log');
  var tScroll = document.getElementById('term-out');
  var tRow = document.getElementById('term-in');
  var tIn = document.getElementById('term-input');
  var tBox = document.getElementById('term');
  var tCwd = document.getElementById('term-cwd');
  var FS_KEY = 'arif-portfolio-fs-v1';
  var HOME = '/home/guest';
  var cwd = HOME, root, busy = false, warned = false, curlAbort = null;
  var cmds = new Map();
  var repl = null; // set while the Python prompt is open
  var hist = [], hpos = 0;
  var SECTIONS = ['top', 'about', 'skills', 'services', 'contact'];

  var T_ABOUT = [
    'Python developer, CTO at Relic Software.',
    'Full-stack web, automation and reverse engineering. I lead projects from first idea to launch.',
    'Python is my strongest language, and FastAPI is where I build most backends.'
  ];
  var T_SKILLS = [
    'Frontend             HTML, CSS, JavaScript',
    'Backend              Python, Node.js, Rust',
    'Mobile app           Java, Kotlin, Swift',
    'System application   C, C++, Rust, C#',
    'Security             Cryptography, Ethical hacking, Reverse engineering'
  ];
  var T_SERVICES = [
    'Application development   scalable web and software applications',
    'Automation and scraping    scripts that take over repetitive work',
    'Reverse engineering        learn how existing software works, then improve it',
    'Ethical hacking            pentests and risk assessments, with clear fixes'
  ];
  var T_PROJECTS = ['50+ projects completed.', 'Code lives on https://github.com/arifchy369'];
  var T_CONTACT = [
    'email      arif@relicsoftware.com',
    'github     https://github.com/arifchy369',
    'blog       https://arifchowdhury.of.to',
    'facebook   https://facebook.com/arifchy369',
    'instagram  https://instagram.com/arifchy369'
  ];
  var T_README = [
    'Welcome to my portfolio shell.',
    '',
    'This is a small shell written in JavaScript, not a server. The files you see',
    'live in your own browser (localStorage). Nothing is uploaded and nobody else sees them.',
    '',
    'Things to try:',
    '  ls -l',
    '  cat about.txt | grep -i python',
    '  mkdir notes && echo hello > notes/hi.txt   (use ; instead of &&)',
    '  curl -s https://api.github.com/users/arifchy369',
    '  python   (opens a Python prompt, loads the first time)',
    '  node -p "[1, 2, 3].map(x => x * 2)"   (JavaScript in a sandboxed worker)',
    '  nano hello.py   (edit a file; ^O saves, ^X exits)',
    '',
    '"reset" brings the original files back. "help" lists every command.'
  ];

  // ----- virtual filesystem -----
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dir(c) { return { t: 'd', c: c || {}, m: Date.now() }; }
  function file(d) { return { t: 'f', d: d, m: Date.now() }; }
  function seed() {
    return dir({
      home: dir({ guest: dir({
        'README.md': file(T_README.join('\n') + '\n'),
        'about.txt': file(T_ABOUT.join('\n') + '\n'),
        'skills.txt': file(T_SKILLS.join('\n') + '\n'),
        'services.txt': file(T_SERVICES.join('\n') + '\n'),
        'contact.txt': file(T_CONTACT.join('\n') + '\n'),
        projects: dir({ 'README.txt': file(T_PROJECTS.join('\n') + '\n') })
      }) }),
      tmp: dir({})
    });
  }
  function load() {
    try {
      var raw = localStorage.getItem(FS_KEY);
      if (raw) { var o = JSON.parse(raw); if (o && o.t === 'd' && o.c) return o; }
    } catch (e) {}
    return seed();
  }
  function save() {
    try { localStorage.setItem(FS_KEY, JSON.stringify(root)); return true; } catch (e) { return false; }
  }
  root = load();
  var storageOK = save();

  function norm(p) {
    var base = p.charAt(0) === '/' ? [] : cwd.split('/').filter(Boolean);
    if (p === '~' || p.indexOf('~/') === 0) { base = HOME.split('/').filter(Boolean); p = p.slice(1); }
    p.split('/').forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') base.pop(); else base.push(s);
    });
    return base;
  }
  function abs(p) { return '/' + norm(p).join('/'); }
  function nodeAt(segs) {
    var n = root;
    for (var i = 0; i < segs.length; i++) {
      if (n.t !== 'd' || !own(n.c, segs[i])) return null;
      n = n.c[segs[i]];
    }
    return n;
  }
  function lookup(p) { return nodeAt(norm(p)); }
  function parentOf(p) {
    var segs = norm(p);
    if (!segs.length) return null;
    var name = segs.pop(), par = nodeAt(segs);
    return par && par.t === 'd' ? { par: par, name: name } : null;
  }
  function setChild(par, name, node) {
    if (name === '__proto__' || name.length > 200) throw new Error('invalid file name');
    par.c[name] = node;
    par.m = Date.now();
  }
  function writeFile(p, text, append) {
    var loc = parentOf(p);
    if (!loc) throw new Error('No such file or directory');
    var ex = own(loc.par.c, loc.name) ? loc.par.c[loc.name] : null;
    if (ex && ex.t === 'd') throw new Error('Is a directory');
    var next = ex && append ? ex.d + text : text;
    if (next.length > 500000) throw new Error('File too large');
    if (ex) { ex.d = next; ex.m = Date.now(); } else setChild(loc.par, loc.name, file(next));
  }
  function clone(n) { return JSON.parse(JSON.stringify(n)); }
  function fixCwd() { while (cwd !== '/' && !lookup(cwd)) cwd = cwd.slice(0, cwd.lastIndexOf('/')) || '/'; }
  function pretty(p) {
    if (p === HOME) return '~';
    if (p.indexOf(HOME + '/') === 0) return '~' + p.slice(HOME.length);
    return p;
  }
  function promptStr() { return 'guest@arif:' + pretty(cwd) + '$'; }
  var tTitle = document.getElementById('term-title');
  function psOf() { return repl.more ? '...' : (repl.kind === 'node' ? '>' : '>>>'); }
  function endRepl() {
    if (repl && repl.kind === 'node') { try { if (repl.w) repl.w.terminate(); } catch (e) {} repl.w = null; }
    repl = null;
  }
  function setPrompt() {
    tCwd.textContent = pretty(cwd);
    var shEl = document.getElementById('term-sh'), pyEl = document.getElementById('term-py');
    if (shEl && pyEl) {
      shEl.hidden = !!repl;
      pyEl.hidden = !repl;
      if (repl) pyEl.textContent = psOf();
    }
    if (tTitle) {
      tTitle.textContent = '';
      var b = document.createElement('b');
      b.textContent = 'guest@arif';
      tTitle.appendChild(b);
      tTitle.appendChild(document.createTextNode(': ' + (repl ? (repl.kind === 'node' ? 'node — REPL' : 'python3 — REPL') : pretty(cwd) + ' — bash')));
    }
  }
  function globRe(pat) {
    return new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  }

  // ----- output -----
  var URL_RE = /https?:\/\/[^\s<>"'`]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  function renderLine(text, cls) {
    var row = document.createElement('div');
    row.className = 'tl' + (cls ? ' ' + cls : '');
    if (cls) {
      row.textContent = text;
    } else {
      var last = 0, m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(text))) {
        var t = m[0].replace(/[.,;:!?)\]}]+$/, '');
        row.appendChild(document.createTextNode(text.slice(last, m.index)));
        var a = document.createElement('a');
        a.textContent = t;
        if (/^https?:/.test(t)) { a.href = t; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        else a.href = 'mailto:' + t;
        row.appendChild(a);
        last = m.index + t.length;
        URL_RE.lastIndex = last;
      }
      row.appendChild(document.createTextNode(text.slice(last)));
    }
    tOut.appendChild(row);
  }
  function renderEcho(p, text) {
    var row = document.createElement('div');
    row.className = 'tl';
    var m = /^([^:]+):(.*)\$$/.exec(p);
    if (m) {
      var su = document.createElement('span'); su.className = 'u'; su.textContent = m[1];
      var sc = document.createElement('span'); sc.textContent = ':';
      var sd = document.createElement('span'); sd.className = 'p'; sd.textContent = m[2];
      var sg = document.createElement('span'); sg.textContent = '$ ';
      [su, sc, sd, sg].forEach(function (n) { row.appendChild(n); });
    } else row.appendChild(document.createTextNode(p + ' '));
    row.appendChild(document.createTextNode(text));
    tOut.appendChild(row);
  }
  function emit(lines, cls) {
    lines.forEach(function (l) { renderLine(l, cls); });
    while (tOut.childNodes.length > 800) tOut.removeChild(tOut.firstChild);
    tScroll.scrollTop = tScroll.scrollHeight;
  }

  // ----- command helpers -----
  function def(name, desc, fn, hidden) { cmds.set(name, { desc: desc, fn: fn, hidden: !!hidden }); }
  function visibleNames() { return Array.from(cmds.keys()).filter(function (n) { return !cmds.get(n).hidden; }); }
  function jump(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  function parse(args, known) {
    var f = {}, rest = [], done = false;
    args.forEach(function (a) {
      if (!done && a === '--') { done = true; return; }
      if (!done && a.length > 1 && a.charAt(0) === '-' && !/^-\d+$/.test(a)) {
        a.slice(1).split('').forEach(function (ch) {
          if (known.indexOf(ch) < 0) throw new Error("invalid option -- '" + ch + "'");
          f[ch] = true;
        });
      } else rest.push(a);
    });
    return { f: f, rest: rest };
  }
  function lines(t) {
    if (t === '') return [];
    var a = t.split('\n');
    if (a[a.length - 1] === '') a.pop();
    return a;
  }
  function nl(arr) { return arr.length ? arr.join('\n') + '\n' : ''; }
  function inputs(cmd, files, io, errs) {
    if (!files.length) return [{ name: '', text: io.stdin || '' }];
    var r = [];
    files.forEach(function (f) {
      if (f === '-') { r.push({ name: '-', text: io.stdin || '' }); return; }
      var n = lookup(f);
      if (!n) errs.push(cmd + ': ' + f + ': No such file or directory');
      else if (n.t === 'd') errs.push(cmd + ': ' + f + ': Is a directory');
      else r.push({ name: f, text: n.d });
    });
    return r;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(ms) {
    var d = new Date(ms || 0);
    return MON[d.getMonth()] + ' ' + String(d.getDate()).padStart(2) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ----- portfolio commands -----
  def('about', 'who I am', function () { return nl(T_ABOUT); });
  def('skills', 'what I work with', function () { return nl(T_SKILLS); });
  def('services', 'what I can build for you', function () { return nl(T_SERVICES); });
  def('projects', 'what I have shipped', function () { return nl(T_PROJECTS); });
  def('contact', 'how to reach me', function () { return nl(T_CONTACT); });
  def('goto', 'scroll the page to a section', function (args) {
    var id = (args[0] || '').toLowerCase();
    if (SECTIONS.indexOf(id) === -1) return 'usage: goto ' + SECTIONS.join('|') + '\n';
    jump(id);
    return 'Scrolling to ' + id + '.\n';
  });
  def('hire', 'jump to the contact form', function () { jump('contact'); return 'Good call. Taking you to the contact form.\n'; });

  // ----- filesystem commands -----
  def('pwd', 'print working directory', function () { return cwd + '\n'; });
  def('cd', 'change directory', function (args) {
    var p = args[0] || '~', n = lookup(p);
    if (!n) throw new Error(p + ': No such file or directory');
    if (n.t !== 'd') throw new Error(p + ': Not a directory');
    cwd = abs(p);
    return '';
  });
  def('ls', 'list directory contents', function (args, io) {
    var o = parse(args, 'alF1'), paths = o.rest.length ? o.rest : ['.'], out = [], errs = [];
    function entry(name, n) { return name + (n.t === 'd' ? '/' : ''); }
    function long(name, n) {
      var size = n.t === 'd' ? 4096 : n.d.length;
      return (n.t === 'd' ? 'drwxr-xr-x' : '-rw-r--r--') + ' guest guest ' + String(size).padStart(6) + ' ' + fmtDate(n.m) + ' ' + entry(name, n);
    }
    paths.forEach(function (p, idx) {
      var n = lookup(p);
      if (!n) { errs.push("ls: cannot access '" + p + "': No such file or directory"); return; }
      if (n.t === 'f') { out.push(o.f.l ? long(p, n) : p); return; }
      var names = Object.keys(n.c).sort();
      if (!o.f.a) names = names.filter(function (x) { return x.charAt(0) !== '.'; });
      var items = names.map(function (x) { return o.f.l ? long(x, n.c[x]) : entry(x, n.c[x]); });
      if (paths.length > 1) out.push((idx ? '\n' : '') + p + ':');
      if (o.f.l || o.f['1'] || !io.tty) out.push.apply(out, items);
      else if (items.length) out.push(items.join('  '));
    });
    return { out: nl(out), err: errs.join('\n') };
  });
  def('cat', 'print files', function (args, io) {
    var files = args, out = '', errs = [];
    if (!files.length) return io.stdin === null ? '' : io.stdin;
    files.forEach(function (f) {
      if (f === '-') { out += io.stdin || ''; return; }
      var n = lookup(f);
      if (!n) errs.push('cat: ' + f + ': No such file or directory');
      else if (n.t === 'd') errs.push('cat: ' + f + ': Is a directory');
      else out += n.d;
    });
    return { out: out, err: errs.join('\n') };
  });
  def('echo', 'print text (use > or >> to write a file)', function (args) {
    if (args[0] === '-n') return args.slice(1).join(' ');
    return args.join(' ') + '\n';
  });
  def('touch', 'create a file or update its time', function (args) {
    if (!args.length) throw new Error('missing file operand');
    var errs = [];
    args.forEach(function (p) {
      var loc = parentOf(p);
      if (!loc) { errs.push("touch: cannot touch '" + p + "': No such file or directory"); return; }
      if (own(loc.par.c, loc.name)) loc.par.c[loc.name].m = Date.now();
      else setChild(loc.par, loc.name, file(''));
    });
    return { out: '', err: errs.join('\n') };
  });
  def('mkdir', 'make directories (-p for parents)', function (args) {
    var o = parse(args, 'p'), errs = [];
    if (!o.rest.length) throw new Error('missing operand');
    o.rest.forEach(function (p) {
      var segs = norm(p), n = root;
      if (!segs.length) { errs.push("mkdir: cannot create directory '/': File exists"); return; }
      if (o.f.p) {
        for (var i = 0; i < segs.length; i++) {
          if (!own(n.c, segs[i])) setChild(n, segs[i], dir());
          n = n.c[segs[i]];
          if (n.t !== 'd') { errs.push("mkdir: cannot create directory '" + p + "': Not a directory"); return; }
        }
        return;
      }
      var loc = parentOf(p);
      if (!loc) errs.push("mkdir: cannot create directory '" + p + "': No such file or directory");
      else if (own(loc.par.c, loc.name)) errs.push("mkdir: cannot create directory '" + p + "': File exists");
      else setChild(loc.par, loc.name, dir());
    });
    return { out: '', err: errs.join('\n') };
  });
  def('rmdir', 'remove empty directories', function (args) {
    if (!args.length) throw new Error('missing operand');
    var errs = [];
    args.forEach(function (p) {
      var loc = parentOf(p), n = loc && own(loc.par.c, loc.name) ? loc.par.c[loc.name] : null;
      if (!n) errs.push("rmdir: failed to remove '" + p + "': No such file or directory");
      else if (n.t !== 'd') errs.push("rmdir: failed to remove '" + p + "': Not a directory");
      else if (Object.keys(n.c).length) errs.push("rmdir: failed to remove '" + p + "': Directory not empty");
      else delete loc.par.c[loc.name];
    });
    fixCwd();
    return { out: '', err: errs.join('\n') };
  });
  def('rm', 'remove files (-r for directories, -f to ignore errors)', function (args) {
    var o = parse(args, 'rRf'), rec = o.f.r || o.f.R, errs = [];
    if (!o.rest.length) { if (o.f.f) return ''; throw new Error('missing operand'); }
    o.rest.forEach(function (p) {
      if (!norm(p).length) { errs.push("rm: it is dangerous to operate recursively on '/'"); return; }
      var lastPart = p.replace(/\/+$/, '').split('/').pop();
      if (lastPart === '.' || lastPart === '..') { errs.push("rm: refusing to remove '.' or '..' directory: skipping '" + p + "'"); return; }
      var loc = parentOf(p), n = loc && own(loc.par.c, loc.name) ? loc.par.c[loc.name] : null;
      if (!n) { if (!o.f.f) errs.push("rm: cannot remove '" + p + "': No such file or directory"); return; }
      if (n.t === 'd' && !rec) { errs.push("rm: cannot remove '" + p + "': Is a directory"); return; }
      delete loc.par.c[loc.name];
      loc.par.m = Date.now();
    });
    fixCwd();
    return { out: '', err: errs.join('\n') };
  });
  function cpmv(name, move) {
    return function (args) {
      var o = parse(args, 'rRf'), rec = o.f.r || o.f.R, r = o.rest, errs = [];
      if (r.length < 2) throw new Error('missing destination file operand');
      var dst = r[r.length - 1], srcs = r.slice(0, -1), dn = lookup(dst);
      if (srcs.length > 1 && !(dn && dn.t === 'd')) throw new Error("target '" + dst + "' is not a directory");
      srcs.forEach(function (s) {
        var sn = lookup(s);
        if (!sn) { errs.push(name + ": cannot stat '" + s + "': No such file or directory"); return; }
        if (!norm(s).length) { errs.push(name + ": cannot operate on '/'"); return; }
        if (sn.t === 'd' && !move && !rec) { errs.push(name + ": -r not specified; omitting directory '" + s + "'"); return; }
        var target = dn && dn.t === 'd' ? dst.replace(/\/+$/, '') + '/' + norm(s).pop() : dst;
        var tl = parentOf(target);
        if (!tl) { errs.push(name + ": cannot create '" + target + "': No such file or directory"); return; }
        var sa = abs(s), ta = abs(target);
        if (sa === ta) { errs.push(name + ": '" + s + "' and '" + target + "' are the same file"); return; }
        if (sn.t === 'd' && (ta + '/').indexOf(sa + '/') === 0) { errs.push(name + ": cannot move or copy '" + s + "' into itself"); return; }
        setChild(tl.par, tl.name, move ? sn : clone(sn));
        if (move) { var sl = parentOf(s); delete sl.par.c[sl.name]; }
      });
      fixCwd();
      return { out: '', err: errs.join('\n') };
    };
  }
  def('cp', 'copy files (-r for directories)', cpmv('cp', false));
  def('mv', 'move or rename files', cpmv('mv', true));
  def('tree', 'show a directory tree', function (args) {
    var p = args[0] || '.', n = lookup(p);
    if (!n) throw new Error(p + ' [error opening dir]');
    if (n.t !== 'd') return p + '\n';
    var out = [p], dc = 0, fc = 0;
    (function walk(node, prefix) {
      var names = Object.keys(node.c).sort().filter(function (x) { return x.charAt(0) !== '.'; });
      names.forEach(function (nm, i) {
        var last = i === names.length - 1, c = node.c[nm];
        out.push(prefix + (last ? '└── ' : '├── ') + nm);
        if (c.t === 'd') { dc++; walk(c, prefix + (last ? '    ' : '│   ')); } else fc++;
      });
    })(n, '');
    out.push('', dc + ' directories, ' + fc + ' files');
    return nl(out);
  });
  def('find', 'search for files: find [path] [-name pat] [-type f|d]', function (args) {
    var start = '.', name = null, type = null, i = 0;
    if (args.length && args[0].charAt(0) !== '-') { start = args[0]; i = 1; }
    for (; i < args.length; i++) {
      if (args[i] === '-name') name = args[++i];
      else if (args[i] === '-type') type = args[++i];
      else throw new Error("unknown predicate '" + args[i] + "'");
    }
    var n = lookup(start);
    if (!n) throw new Error("'" + start + "': No such file or directory");
    var re = name ? globRe(name) : null, out = [];
    (function walk(nd, path, nm) {
      var ok = (!re || re.test(nm)) && (!type || (type === 'd' && nd.t === 'd') || (type === 'f' && nd.t === 'f'));
      if (ok) out.push(path);
      if (nd.t === 'd') Object.keys(nd.c).sort().forEach(function (k) { walk(nd.c[k], path.replace(/\/$/, '') + '/' + k, k); });
    })(n, start, start.split('/').filter(Boolean).pop() || '/');
    return nl(out);
  });

  // ----- text commands -----
  function headTail(name, isHead) {
    return function (args, io) {
      var n = 10, files = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a === '-n') { n = parseInt(args[++i], 10); if (isNaN(n) || n < 0) throw new Error('invalid number of lines'); }
        else if (/^-\d+$/.test(a)) n = +a.slice(1);
        else files.push(a);
      }
      var errs = [], out = [], ins = inputs(name, files, io, errs);
      ins.forEach(function (x, idx) {
        if (ins.length > 1) out.push((idx ? '\n' : '') + '==> ' + x.name + ' <==');
        var l = lines(x.text);
        out.push.apply(out, isHead ? l.slice(0, n) : (n ? l.slice(-n) : []));
      });
      return { out: nl(out), err: errs.join('\n') };
    };
  }
  def('head', 'first lines of a file (-n N)', headTail('head', true));
  def('tail', 'last lines of a file (-n N)', headTail('tail', false));
  def('wc', 'count lines, words and bytes (-l -w -c)', function (args, io) {
    var o = parse(args, 'lwc'), all = !o.f.l && !o.f.w && !o.f.c, errs = [], tot = [0, 0, 0];
    function fmt(c, name) {
      var p = [];
      if (all || o.f.l) p.push(c[0]);
      if (all || o.f.w) p.push(c[1]);
      if (all || o.f.c) p.push(c[2]);
      return p.join(' ') + (name ? ' ' + name : '');
    }
    var ins = inputs('wc', o.rest, io, errs);
    var out = ins.map(function (x) {
      var t = x.text, c = [(t.match(/\n/g) || []).length, t.split(/\s+/).filter(Boolean).length, new TextEncoder().encode(t).length];
      c.forEach(function (v, i) { tot[i] += v; });
      return fmt(c, x.name);
    });
    if (ins.length > 1) out.push(fmt(tot, 'total'));
    return { out: nl(out), err: errs.join('\n') };
  });
  def('grep', 'search text: grep [-inv] pattern [file...]', function (args, io) {
    var o = parse(args, 'inv');
    if (!o.rest.length) throw new Error('usage: grep [-inv] pattern [file...]');
    var re;
    try { re = new RegExp(o.rest[0], o.f.i ? 'i' : ''); } catch (e) { throw new Error('invalid pattern: ' + o.rest[0]); }
    var errs = [], out = [], ins = inputs('grep', o.rest.slice(1), io, errs), multi = ins.length > 1;
    ins.forEach(function (x) {
      lines(x.text).forEach(function (ln, i) {
        if (re.test(ln) !== !!o.f.v) out.push((multi ? x.name + ':' : '') + (o.f.n ? (i + 1) + ':' : '') + ln);
      });
    });
    return { out: nl(out), err: errs.join('\n') };
  });
  def('sort', 'sort lines (-r reverse, -n numeric, -u unique)', function (args, io) {
    var o = parse(args, 'rnu'), errs = [], all = [];
    inputs('sort', o.rest, io, errs).forEach(function (x) { all = all.concat(lines(x.text)); });
    all.sort(function (a, b) {
      if (o.f.n) { var d = parseFloat(a) - parseFloat(b); if (d) return d; }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (o.f.r) all.reverse();
    if (o.f.u) all = all.filter(function (l, i) { return i === 0 || l !== all[i - 1]; });
    return { out: nl(all), err: errs.join('\n') };
  });
  def('uniq', 'collapse repeated lines (-c count)', function (args, io) {
    var o = parse(args, 'c'), errs = [], out = [];
    inputs('uniq', o.rest.slice(0, 1), io, errs).forEach(function (x) {
      var prev = null, cnt = 0;
      function flush() { if (prev !== null) out.push(o.f.c ? String(cnt).padStart(7) + ' ' + prev : prev); }
      lines(x.text).forEach(function (l) { if (l === prev) cnt++; else { flush(); prev = l; cnt = 1; } });
      flush();
    });
    return { out: nl(out), err: errs.join('\n') };
  });

  // ----- network -----
  var CURL_HELP = [
    'Usage: curl [options...] <url>',
    'Makes a real request from your browser and prints the response.',
    'The server has to allow CORS, otherwise the browser blocks the answer.',
    '',
    ' -o, --output <file>     write the body to a file instead of the screen',
    ' -O, --remote-name       save under the name in the URL (index.html if it has none)',
    ' -I, --head              show the headers only (HEAD request)',
    ' -i, --include           print the response headers before the body',
    ' -X, --request <method>  request method: GET, POST, PUT, DELETE ...',
    ' -d, --data <data>       send data (the method becomes POST)',
    ' -H, --header <h:v>      add a request header, for example "Accept: application/json"',
    ' -f, --fail              fail quietly on HTTP errors (status 400 and up)',
    ' -s, -S, -L              accepted and ignored (redirects are always followed)',
    ' -h, --help              show this help',
    ' -V, --version           show the version',
    '',
    'Examples:',
    '  curl https://api.github.com/users/arifchy369',
    '  curl -I https://example.com',
    '  curl -s https://example.com -o page.html',
    '  curl -X POST -d \'{"a":1}\' -H "Content-Type: application/json" https://httpbin.org/post',
    '',
    'Limits: text, JSON and similar replies up to 200 KB, 20 second timeout.'
  ];
  def('curl', 'fetch a URL (real request; the server must allow CORS)', async function (args) {
    var url = null, outFile = null, remoteName = false, head = false, inc = false, fail = false, method = null, body = null, headers = {};
    function opt(ch, val) {
      if (ch === 'o') outFile = val;
      else if (ch === 'O') remoteName = true;
      else if (ch === 'I') head = true;
      else if (ch === 'i') inc = true;
      else if (ch === 'f') fail = true;
      else if (ch === 'X') method = String(val || '').toUpperCase();
      else if (ch === 'd') body = String(val === undefined ? '' : val);
      else if (ch === 'H') {
        var k = String(val || '').indexOf(':');
        if (k > 0) headers[val.slice(0, k).trim()] = val.slice(k + 1).trim();
      }
    }
    if (!args.length) return nl(CURL_HELP);
    var LONG = { '--silent': 's', '--head': 'I', '--include': 'i', '--output': 'o', '--remote-name': 'O', '--location': 'L', '--request': 'X', '--data': 'd', '--header': 'H', '--fail': 'f' };
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-h' || a === '--help') return nl(CURL_HELP);
      if (a === '-V' || a === '--version') return 'curl (browser edition: it uses fetch(), so it is not the real curl)\n';
      if (LONG[a]) { var c1 = LONG[a]; opt(c1, 'oXdH'.indexOf(c1) >= 0 ? args[++i] : undefined); }
      else if (/^-[A-Za-z]+$/.test(a)) {
        var letters = a.slice(1).split('');
        for (var j = 0; j < letters.length; j++) {
          var ch = letters[j];
          if ('sSLfiIO'.indexOf(ch) >= 0) opt(ch);
          else if ('oXdH'.indexOf(ch) >= 0) opt(ch, args[++i]);
          else throw new Error('option ' + a + ': is unknown');
        }
      } else if (a.charAt(0) === '-') throw new Error('option ' + a + ': is unknown');
      else url = a;
    }
    if (!url) throw new Error("no URL specified (try 'curl --help')");
    var u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(\/|\.\/|\.\.\/)/.test(url) ? url : 'https://' + url, location.href); }
    catch (e) { throw new Error('(3) URL using bad/illegal format'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('(1) Protocol "' + u.protocol.replace(':', '') + '" not supported');
    var ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 20000), res;
    curlAbort = ac;
    try {
      try {
        res = await fetch(u.href, {
          method: method || (head ? 'HEAD' : (body !== null ? 'POST' : 'GET')),
          headers: headers, body: body === null ? undefined : body,
          signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('(28) Operation timed out or was interrupted');
        throw new Error('(7) Failed to connect to ' + u.host + '. In a browser this usually means the server does not send CORS headers.');
      }
      if (fail && !res.ok) throw new Error('(22) The requested URL returned error: ' + res.status);
      var hdr = '';
      if (head || inc) {
        var hl = ['HTTP ' + res.status + ' ' + res.statusText];
        res.headers.forEach(function (v, k) { hl.push(k + ': ' + v); });
        hdr = hl.join('\n') + '\n\n';
      }
      var text = '';
      if (!head) {
        var ct = res.headers.get('content-type') || '';
        if (ct && !/text|json|xml|javascript|yaml|csv|svg/i.test(ct)) throw new Error('(23) binary content is not supported here (' + ct.split(';')[0] + ')');
        text = await res.text();
        if (text.length > 200000) throw new Error('(63) response is larger than 200 KB, not saving');
      }
      if (outFile || remoteName) {
        var fname = outFile || u.pathname.split('/').filter(Boolean).pop() || 'index.html';
        writeFile(fname, (inc ? hdr : '') + text, false);
        return '';
      }
      var full = hdr + text;
      return full && full.slice(-1) !== '\n' ? full + '\n' : full;
    } finally {
      clearTimeout(timer);
      curlAbort = null;
    }
  });

  // ----- Python: real CPython (Pyodide), downloaded the first time `python` is used -----
  var PY_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  var pyPromise = null, pyReady = false, outBuf = [];
  var PY_SETUP = [
    'import sys, time, code',
    '_dl = [0.0]',
    'def _tracer(frame, event, arg):',
    '    if time.monotonic() > _dl[0]:',
    '        raise TimeoutError("stopped: the code ran for more than 8 seconds")',
    '    return _tracer',
    'def _arm():',
    '    _dl[0] = float("inf")',
    '    pass',
    'def _disarm():',
    '    sys.settrace(None)',
    '    sys.stdout.flush()',
    '    sys.stderr.flush()',
    '_con = code.InteractiveConsole({"__name__": "__main__", "__doc__": None})',
    'def _push(line):',
    '    return _con.push(line)',
    'def _reset():',
    '    _con.resetbuffer()',
    'sys.version.split()[0]'
  ].join('\n');
  function loadPy() {
    if (pyPromise) return pyPromise;
    var p = new Promise(function (res, rej) {
      function boot() { loadPyodide({ indexURL: PY_URL }).then(res, rej); }
      if (typeof loadPyodide === 'function') { boot(); return; }
      var s = document.createElement('script');
      s.src = PY_URL + 'pyodide.js';
      s.onload = boot;
      s.onerror = function () { rej(new Error('could not download the Python runtime (offline, or blocked by the browser)')); };
      document.head.appendChild(s);
    }).then(function (py) {
      var ver = py.runPython(PY_SETUP);
      py.setStdout({ batched: function (s) { outBuf.push([s, '']); } });
      py.setStderr({ batched: function (s) { outBuf.push([s, 'err']); } });
      py.setStdin({ stdin: function () { return undefined; } });
      var g = py.globals;
      pyReady = true;
      return { py: py, ver: ver, arm: g.get('_arm'), disarm: g.get('_disarm'), push: g.get('_push'), reset: g.get('_reset') };
    });
    p.catch(function () { if (pyPromise === p) pyPromise = null; });
    pyPromise = p;
    return p;
  }
  function cleanTb(msg, name) {
    var l = String(msg).split('\n'), i = -1;
    for (var k = 0; k < l.length; k++) { if (l[k].indexOf('"<exec>"') > -1) { i = k; break; } }
    var body = i < 0 ? l : ['Traceback (most recent call last):'].concat(l.slice(i));
    return body.join('\n').replace(/"<exec>"/g, '"' + name + '"').trim();
  }
  function isExit(e) { return /^SystemExit/.test(String(e && e.message).trim().split('\n').pop()); }
  async function pyPackages(rt, src) {
    if (!/^\s*(import|from)\s/m.test(src)) return;
    try {
      await rt.py.loadPackagesFromImports(src, { messageCallback: function (m) { emit([m], 'dim'); }, errorCallback: function () {} });
    } catch (e) {}
  }
  function flushPy() {
    var b = outBuf;
    outBuf = [];
    b.forEach(function (x) { emit([x[0]], x[1] || undefined); });
  }
  async function replLine(raw) {
    if (repl && repl.kind === 'node') return nodeReplLine(raw);
    busy = true;
    var hadFocus = document.activeElement === tIn;
    tRow.hidden = true;
    var rt = repl.rt, text = String(raw), low = text.trim();
    renderEcho(repl.more ? '...' : '>>>', text);
    if (low) { hist.push(text); hpos = hist.length; }
    if (!repl.more && /^(exit|quit)(\(\))?$/.test(low)) {
      repl = null;
    } else if (low || repl.more) {
      outBuf = [];
      await pyPackages(rt, text);
      rt.arm();
      try { repl.more = !!rt.push(text); }
      catch (e) {
        repl.more = false;
        rt.reset();
        if (isExit(e)) repl = null; else outBuf.push([cleanTb(e.message, '<stdin>'), 'err']);
      } finally { rt.disarm(); }
      flushPy();
    }
    busy = false;
    tRow.hidden = false;
    setPrompt();
    tScroll.scrollTop = tScroll.scrollHeight;
    if (hadFocus) tIn.focus({ preventScroll: true });
  }
  def('python', 'run Python: python | python file.py | python -c "code"', async function (args) {
    var src = null, name = '<stdin>';
    if (args[0] === '--version' || args[0] === '-V') return 'Python 3.12\n';
    if (args[0] === '-c') {
      if (args.length < 2) throw new Error('Argument expected for the -c option');
      src = args[1]; name = '<string>';
    } else if (args.length) {
      var n = lookup(args[0]);
      if (!n) throw new Error("can't open file '" + args[0] + "': No such file or directory");
      if (n.t === 'd') throw new Error("can't open file '" + args[0] + "': Is a directory");
      src = n.d; name = args[0];
    }
    if (!pyReady) emit(['Loading Python...'], 'dim');
    var rt;
    try { rt = await loadPy(); } catch (e) { throw new Error(e && e.message ? e.message : String(e)); }
    outBuf = [];
    if (src === null) {
      repl = { rt: rt, more: false };
      rt.reset();
      return 'Python ' + rt.ver + ' (Pyodide) on a web browser\nType exit() or press Ctrl+D to leave.\n';
    }
    await pyPackages(rt, src);
    var g = rt.py.runPython('{"__name__": "__main__"}'), errTxt = '';
    rt.arm();
    try { rt.py.runPython(src, { globals: g }); }
    catch (e) { if (!isExit(e)) errTxt = cleanTb(e.message, name); }
    finally { rt.disarm(); g.destroy(); }
    var o = [], er = [];
    outBuf.forEach(function (x) { (x[1] ? er : o).push(x[0]); });
    outBuf = [];
    if (errTxt) er.push(errTxt);
    return { out: o.length ? o.join('\n') + '\n' : '', err: er.join('\n') };
  });
  cmds.set('python3', cmds.get('python'));

  // ----- node: JavaScript in a Web Worker -----
  // Not real Node.js. The code runs in a Worker, so it has no DOM and no localStorage and cannot reach this
  // page or the shell's files. Network APIs are switched off inside the worker (best effort), there is no time
  // limit (Ctrl+C stops a run) and output is capped. Only require('util') exists. The worker source is nodeWorkerMain() below.
  var NODE_MS = Infinity, NODE_OUT_MAX = 400000, nodeUrl = null;
  function nodeWorkerMain() {
    var post = self.postMessage.bind(self);
    var realST = self.setTimeout.bind(self), realCT = self.clearTimeout.bind(self);
    var realSI = self.setInterval.bind(self), realCI = self.clearInterval.bind(self);
    var buf = [], size = 0, total = 0, LIMIT = 200000, stopped = false, finished = false, sched = false;
    var mode = 'run', ind = '', cwdStr = '/home/guest', active = {};

    // Switch off everything that could talk to the network or spawn a fresh, unrestricted worker.
    var BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches',
      'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport', 'close'];
    (function () {
      var o = self;
      while (o && o !== Object.prototype) {
        BLOCK.forEach(function (n) { try { if (Object.prototype.hasOwnProperty.call(o, n)) delete o[n]; } catch (e) {} });
        o = Object.getPrototypeOf(o);
      }
      BLOCK.forEach(function (n) {
        var stub = (n === 'indexedDB' || n === 'caches') ? undefined : function () { throw new Error(n + ' is disabled in this sandbox'); };
        try { Object.defineProperty(self, n, { value: stub, writable: false, configurable: false }); } catch (e) {}
      });
    })();

    function flush() { if (buf.length) { var c = buf; buf = []; size = 0; post({ k: 'o', c: c }); } }
    function write(cls, s) {
      if (stopped) return;
      s = String(s);
      total += s.length;
      if (total > LIMIT) { stopped = true; flush(); post({ k: 'limit' }); return; }
      buf.push([cls, s]);
      size += s.length;
      if (size > 512) flush();
      else if (!sched) { sched = true; realST(function () { sched = false; flush(); }, 20); }
    }
    function raw(cls, s) { write(cls, s + '\n'); }

    // ----- value formatting (a small util.inspect) -----
    function q(s) {
      var c = s.indexOf("'") < 0 ? "'" : (s.indexOf('"') < 0 ? '"' : '`');
      return c + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n') + c;
    }
    function key(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k); }
    function wrap(o, c, parts) {
      if (!parts.length) return o + c;
      var one = o + ' ' + parts.join(', ') + ' ' + c;
      if (one.length <= 72 && one.indexOf('\n') < 0) return one;
      return o + '\n' + parts.map(function (p) { return '  ' + p.replace(/\n/g, '\n  '); }).join(',\n') + '\n' + c;
    }
    function ins(v, d, seen) {
      var t = typeof v;
      if (v === null) return 'null';
      if (t === 'string') return q(v);
      if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
      if (t === 'bigint') return v + 'n';
      if (t === 'symbol') return v.toString();
      if (t !== 'object' && t !== 'function') return String(v);
      if (t === 'function') {
        var fs = '';
        try { fs = Function.prototype.toString.call(v); } catch (e) {}
        var nm = v.name || '(anonymous)';
        return /^class[\s{]/.test(fs) ? '[class ' + nm + ']' : '[Function: ' + nm + ']';
      }
      if (seen.indexOf(v) > -1) return '[Circular]';
      if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message;
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
      if (v instanceof RegExp) return String(v);
      if (v instanceof Promise) return 'Promise { <unknown> }';
      if (v instanceof WeakMap || v instanceof WeakSet) return '[' + (v instanceof WeakMap ? 'WeakMap' : 'WeakSet') + ']';
      if (d < 0) return Array.isArray(v) ? '[Array]' : '[Object]';
      seen = seen.concat([v]);
      var parts = [], pre = '', open = '{', close = '}', i;
      if (Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView))) {
        open = '['; close = ']';
        if (!Array.isArray(v)) pre = v.constructor.name + '(' + v.length + ') ';
        for (i = 0; i < v.length && i < 100; i++) parts.push(i in v ? ins(v[i], d - 1, seen) : '<1 empty item>');
        if (v.length > 100) parts.push('... ' + (v.length - 100) + ' more items');
      } else if (v instanceof Map) {
        pre = 'Map(' + v.size + ') ';
        v.forEach(function (val, k) { if (parts.length < 100) parts.push(ins(k, d - 1, seen) + ' => ' + ins(val, d - 1, seen)); });
      } else if (v instanceof Set) {
        pre = 'Set(' + v.size + ') ';
        v.forEach(function (val) { if (parts.length < 100) parts.push(ins(val, d - 1, seen)); });
      } else {
        var proto = Object.getPrototypeOf(v), cn = proto && proto.constructor && proto.constructor.name;
        if (!proto) pre = '[Object: null prototype] ';
        else if (cn && cn !== 'Object') pre = cn + ' ';
        var ks = Object.keys(v);
        ks.slice(0, 100).forEach(function (k) {
          var s;
          try { s = ins(v[k], d - 1, seen); } catch (e) { s = '[Getter]'; }
          parts.push(key(k) + ': ' + s);
        });
        if (ks.length > 100) parts.push('... ' + (ks.length - 100) + ' more properties');
      }
      return pre + wrap(open, close, parts);
    }
    function format(args) {
      var a = args.slice(), rest;
      if (typeof a[0] === 'string' && a.length > 1 && a[0].indexOf('%') > -1) {
        var f = a.shift(), idx = 0;
        f = f.replace(/%([sdifjoO%])/g, function (m, c) {
          if (c === '%') return '%';
          if (idx >= a.length) return m;
          var x = a[idx++];
          if (c === 's') return typeof x === 'string' ? x : (typeof x === 'object' && x !== null ? ins(x, 1, []) : String(x));
          if (c === 'd') return typeof x === 'object' ? 'NaN' : String(Number(x));
          if (c === 'i') return typeof x === 'object' ? 'NaN' : String(parseInt(x, 10));
          if (c === 'f') return String(parseFloat(x));
          if (c === 'j') { try { return JSON.stringify(x); } catch (e) { return '[Circular]'; } }
          return ins(x, 2, []);
        });
        rest = a.slice(idx);
        a = [f].concat(rest);
      }
      return a.map(function (x) { return typeof x === 'string' ? x : ins(x, 2, []); }).join(' ');
    }

    // ----- console, process, require, timers -----
    function line(cls, args) { var s = format(args); write(cls, (ind ? s.replace(/^/gm, ind) : s) + '\n'); }
    var counts = {}, clocks = {};
    function depthOf(o) { return o && typeof o.depth === 'number' ? o.depth : 2; }
    function lbl(l) { return l === undefined ? 'default' : String(l); }
    var cons = {
      log: function () { line('o', [].slice.call(arguments)); },
      error: function () { line('e', [].slice.call(arguments)); },
      dir: function (v, o) { write('o', (ind ? ind : '') + ins(v, depthOf(o), []) + '\n'); },
      assert: function (c) {
        if (c) return;
        var r = [].slice.call(arguments, 1);
        write('e', ind + 'Assertion failed' + (r.length ? ': ' + format(r) : '') + '\n');
      },
      group: function () { if (arguments.length) line('o', [].slice.call(arguments)); ind += '  '; },
      groupEnd: function () { ind = ind.slice(2); },
      count: function (l) { l = lbl(l); counts[l] = (counts[l] || 0) + 1; write('o', ind + l + ': ' + counts[l] + '\n'); },
      time: function (l) { clocks[lbl(l)] = performance.now(); },
      timeEnd: function (l) { cons.timeLog(l); delete clocks[lbl(l)]; },
      timeLog: function (l) {
        l = lbl(l);
        if (clocks[l] === undefined) { write('e', 'Warning: No such label \'' + l + '\' for console.time()\n'); return; }
        write('o', ind + l + ': ' + (performance.now() - clocks[l]).toFixed(3) + 'ms\n');
      },
      clear: function () {}
    };
    cons.info = cons.debug = cons.log;
    cons.warn = cons.trace = cons.error;
    cons.table = cons.dir;
    self.console = cons;

    function ExitSignal(code) { this.code = code; }
    var process = {
      argv: ['node'], env: {}, platform: 'browser', version: 'browser-worker', versions: {}, pid: 1, exitCode: 0,
      cwd: function () { return cwdStr; },
      exit: function (c) { throw new ExitSignal(c === undefined ? process.exitCode : c); },
      nextTick: function (fn) { var a = [].slice.call(arguments, 1); queueMicrotask(function () { guard(fn, a); }); },
      on: function () { return process; },
      stdout: { write: function (s) { write('o', s); return true; }, isTTY: false },
      stderr: { write: function (s) { write('e', s); return true; }, isTTY: false }
    };
    self.process = process;
    var utilMod = {
      inspect: function (v, o) { return ins(v, depthOf(o), []); },
      format: function () { return format([].slice.call(arguments)); }
    };
    self.require = function (n) {
      n = String(n).replace(/^node:/, '');
      if (n === 'util') return utilMod;
      throw new Error("Cannot find module '" + n + "'. Only 'util' is available in this sandbox.");
    };
    self.module = { exports: {} };
    self.exports = self.module.exports;

    // Timers are wrapped so we know when nothing is left to wait for, and so process.exit() works inside them.
    self.setTimeout = function (fn, ms) {
      var a = [].slice.call(arguments, 2), id;
      id = realST(function () { delete active[id]; guard(fn, a); }, ms);
      active[id] = 1;
      return id;
    };
    self.setInterval = function (fn, ms) {
      var a = [].slice.call(arguments, 2), id;
      id = realSI(function () { guard(fn, a); }, ms);
      active[id] = 1;
      return id;
    };
    self.clearTimeout = function (id) { delete active[id]; realCT(id); };
    self.clearInterval = function (id) { delete active[id]; realCI(id); };
    self.setImmediate = function (fn) { return self.setTimeout.apply(self, [fn, 0].concat([].slice.call(arguments, 1))); };
    self.clearImmediate = self.clearTimeout;

    // ----- errors and finishing -----
    function printErr(e, pre) {
      var t;
      try { t = e instanceof Error ? (pre || '') + (e.name || 'Error') + ': ' + e.message : 'Uncaught ' + ins(e, 2, []); }
      catch (x) { t = 'Uncaught exception'; }
      raw('e', t);
    }
    function finish(code) { if (finished) return; finished = true; flush(); post({ k: 'done', code: code || 0 }); }
    function thrown(e) {
      if (e instanceof ExitSignal) { if (mode === 'repl') { flush(); post({ k: 'rexit' }); } else finish(e.code); return; }
      printErr(e, mode === 'repl' ? 'Uncaught ' : '');
      if (mode !== 'repl') finish(1);
      else flush();
    }
    function guard(fn, a) {
      try { return fn.apply(null, a); } catch (e) { thrown(e); }
    }
    self.addEventListener('error', function (ev) {
      ev.preventDefault();
      thrown(ev.error !== undefined && ev.error !== null ? ev.error : new Error(ev.message));
    });
    self.addEventListener('unhandledrejection', function (ev) { ev.preventDefault(); thrown(ev.reason); });

    // ----- run mode: node file.js | -e | -p -----
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    function settle() {
      realST(function idle() {
        if (finished) return;
        for (var k in active) { realST(idle, 10); return; }
        finish(0);
      }, 0);
    }
    function startRun(m) {
      mode = 'run';
      if (typeof m.cwd === 'string') cwdStr = m.cwd;
      var extra = Array.isArray(m.args) ? m.args.map(String) : [];
      process.argv = m.mode === 'file' ? ['node', String(m.name)].concat(extra) : ['node'].concat(extra);
      var src = String(m.src);
      if (m.mode === 'print') {
        var v;
        try { v = (0, eval)(src); } catch (e) { thrown(e); return; }
        Promise.resolve(v).then(function (x) { raw('o', typeof x === 'string' ? x : ins(x, 2, [])); settle(); }, thrown);
        return;
      }
      src = src.replace(/^#!.*/, '//');
      var fn, mod = { exports: {} }, p;
      try { fn = new AsyncFunction('exports', 'require', 'module', '__filename', '__dirname', src); }
      catch (e) { thrown(e); return; }
      try { p = fn.call(mod.exports, mod.exports, self.require, mod, String(m.name), String(m.name).replace(/\/[^\/]*$/, '') || '/'); }
      catch (e) { thrown(e); return; }
      p.then(settle, thrown);
    }

    // ----- REPL mode: one persistent global scope, a line (or buffer) at a time -----
    var MORE = /end of (input|script|data)|unterminated|missing [)}\]]/i;
    function replDone() { flush(); post({ k: 'rdone' }); }
    function replEval(text) {
      mode = 'repl';
      var src = text, r;
      if (/^\s*\{[\s\S]*\}\s*$/.test(src)) {
        try { new Function('return (' + src + '\n)'); src = '(' + src + '\n)'; } catch (e) {}
      }
      // let, const and class would vanish after each eval, so they become var and stay for the next line
      src = src.replace(/^(\s*)(const|let)\s+/, '$1var ').replace(/^(\s*)class\s+([A-Za-z_$][\w$]*)/, '$1var $2 = class $2');
      try { r = (0, eval)(src); }
      catch (e) {
        if (e instanceof SyntaxError && MORE.test(String(e.message))) { flush(); post({ k: 'more' }); return; }
        if (e instanceof ExitSignal) { flush(); post({ k: 'rexit' }); return; }
        printErr(e, 'Uncaught ');
        replDone();
        return;
      }
      if (r instanceof Promise) {
        var NONE = {};
        Promise.race([r, new Promise(function (res) { realST(function () { res(NONE); }, 0); })]).then(function (x) {
          raw('o', x === NONE ? 'Promise { <pending> }' : 'Promise { ' + ins(x, 2, []) + ' }');
          replDone();
        }, function (e) {
          raw('o', 'Promise { <rejected> ' + ins(e, 2, []) + ' }');
          replDone();
        });
        return;
      }
      raw('o', ins(r, 2, []));
      replDone();
    }

    self.onmessage = function (ev) {
      var m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.k === 'run') startRun(m);
      else if (m.k === 'repl') replEval(String(m.src));
      else if (m.k === 'init' && typeof m.cwd === 'string') cwdStr = m.cwd;
    };
  }
  function nodeSpawn() {
    if (!window.Worker || !window.Blob || !window.URL || !URL.createObjectURL) throw new Error('this browser cannot run Web Workers');
    if (!nodeUrl) nodeUrl = URL.createObjectURL(new Blob(['(' + nodeWorkerMain.toString() + ')();'], { type: 'text/javascript' }));
    return new Worker(nodeUrl);
  }
  // Messages from the worker are untrusted data: only known shapes are used, and everything is shown as text.
  function nodeChunks(d, cb) {
    if (!d || typeof d !== 'object' || d.k !== 'o' || !Array.isArray(d.c)) return;
    d.c.forEach(function (x) {
      if (Array.isArray(x) && typeof x[1] === 'string') cb(x[0] === 'e' ? 'e' : 'o', x[1].slice(0, 100000));
    });
  }
  function nodeRun(src, name, mode, args) {
    return new Promise(function (resolve) {
      var w, o = [], er = [], size = 0, settled = false, timer;
      try { w = nodeSpawn(); } catch (e) { resolve({ out: '', err: 'node: ' + e.message }); return; }
      function end(note) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { w.terminate(); } catch (e) {}
        curlAbort = null;
        if (note) er.push(note + '\n');
        resolve({ out: o.join(''), err: er.join('').replace(/\n$/, '') });
      }
      w.onmessage = function (ev) {
        var d = ev.data;
        if (settled || !d || typeof d !== 'object') return;
        if (d.k === 'o') {
          nodeChunks(d, function (c, s) { size += s.length; (c === 'e' ? er : o).push(s); });
          if (size > NODE_OUT_MAX) end('node: stopped: too much output');
        } else if (d.k === 'limit') end('node: stopped: more than 200 KB of output');
        else if (d.k === 'done') end('');
      };
      w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        end('node: ' + (ev && ev.message ? ev.message : 'the worker failed to start'));
      };
      if (isFinite(NODE_MS)) timer = setTimeout(function () { end('node: stopped: the code ran for more than ' + (NODE_MS / 1000) + ' seconds'); }, NODE_MS);
      curlAbort = { abort: function () { end('node: interrupted'); } }; // Ctrl+C
      w.postMessage({ k: 'run', src: src, name: name, mode: mode, args: args, cwd: cwd });
    });
  }

  // REPL (typing `node` alone)
  function nodeReplWorker(r) {
    var w = nodeSpawn();
    r.w = w;
    w.onmessage = function (ev) {
      if (r.w !== w) return;
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.k === 'o') {
        nodeChunks(d, function (c, s) {
          if (s.slice(-1) === '\n') s = s.slice(0, -1);
          emit(s.split('\n'), c === 'e' ? 'err' : undefined);
        });
      } else if (d.k === 'rdone' || d.k === 'more' || d.k === 'rexit' || d.k === 'limit') nodeWake(r, d.k);
    };
    w.onerror = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (r.w === w) nodeWake(r, 'error');
    };
    w.postMessage({ k: 'init', cwd: cwd });
  }
  function nodeWake(r, why) {
    var p = r.wait;
    if (!p) return;
    r.wait = null;
    clearTimeout(p.timer);
    p.resolve(why);
  }
  function nodeReplStart() {
    var r = { kind: 'node', more: false, buf: '', w: null, wait: null };
    r.rt = { reset: function () { r.buf = ''; } }; // Ctrl+C drops a half-typed block
    nodeReplWorker(r); // throws here, before the prompt changes, if workers are unavailable
    repl = r;
  }
  async function nodeReplLine(raw) {
    busy = true;
    var hadFocus = document.activeElement === tIn;
    tRow.hidden = true;
    var r = repl, text = String(raw), low = text.trim();
    renderEcho(psOf(), text);
    if (low) { hist.push(text); hpos = hist.length; }
    if (!r.more && low === '.exit') {
      endRepl();
    } else if (low || r.more) {
      r.buf = r.buf ? r.buf + '\n' + text : text;
      var why;
      try {
        if (!r.w) nodeReplWorker(r);
        why = await new Promise(function (resolve) {
          r.wait = { resolve: resolve, timer: isFinite(NODE_MS) ? setTimeout(function () { nodeWake(r, 'timeout'); }, NODE_MS) : null };
          curlAbort = { abort: function () { nodeWake(r, 'interrupt'); } }; // Ctrl+C
          r.w.postMessage({ k: 'repl', src: r.buf });
        });
      } catch (e) {
        why = 'error';
      }
      curlAbort = null;
      if (why === 'more') r.more = true;
      else if (why === 'rexit') endRepl();
      else {
        r.more = false;
        r.buf = '';
        if (why !== 'rdone') {
          try { if (r.w) r.w.terminate(); } catch (e) {}
          r.w = null;
          emit([why === 'timeout' ? 'Uncaught: stopped, the code ran for more than ' + (NODE_MS / 1000) + ' seconds. The session restarted, so earlier variables are gone.'
            : why === 'interrupt' ? 'Uncaught: interrupted. The session restarted, so earlier variables are gone.'
            : why === 'limit' ? 'Uncaught: stopped, more than 200 KB of output. The session restarted, so earlier variables are gone.'
            : 'Uncaught: the JavaScript worker stopped. The session restarted, so earlier variables are gone.'], 'err');
        }
      }
    }
    busy = false;
    tRow.hidden = false;
    setPrompt();
    tScroll.scrollTop = tScroll.scrollHeight;
    if (hadFocus) tIn.focus({ preventScroll: true });
  }
  def('node', 'run JavaScript: node | node file.js | node -e "code" | node -p "expr"', async function (args, io) {
    var src = null, name = '[eval]', mode = 'file', rest = [], a0 = args[0];
    if (a0 === '--version' || a0 === '-v') return 'JavaScript in a Web Worker (this is not real Node.js)\n';
    if (a0 === '-e' || a0 === '--eval' || a0 === '-p' || a0 === '--print') {
      if (args.length < 2) throw new Error(a0 + ' requires an argument');
      src = args[1];
      mode = a0 === '-p' || a0 === '--print' ? 'print' : 'eval';
      rest = args.slice(2);
    } else if (args.length) {
      var n = lookup(a0);
      if (!n) throw new Error("Cannot find module '" + abs(a0) + "'");
      if (n.t === 'd') throw new Error("'" + a0 + "' is a directory");
      src = n.d; name = abs(a0); rest = args.slice(1);
    } else if (io && io.stdin) {
      src = io.stdin; name = '[stdin]';
    }
    if (src === null) {
      nodeReplStart();
      return 'JavaScript in a Web Worker (this is not real Node.js).\nType .exit or press Ctrl+D to leave.\n';
    }
    return nodeRun(src, name, mode, rest);
  });

  // ----- nano: a small full-screen text editor (saves into the virtual filesystem) -----
  var nn = null, nanoEl = null;
  function nanoBuild() {
    if (nanoEl) return nanoEl;
    var el = document.createElement('div');
    el.className = 'nano';
    el.hidden = true;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'nano text editor');
    el.innerHTML = '<div class="nano-head"><span>GNU nano 7.2</span><span class="nano-name"></span><span class="nano-mod"></span></div>' +
      '<textarea class="nano-text" wrap="off" spellcheck="false" autocapitalize="none" autocorrect="off" aria-label="Editor"></textarea>' +
      '<div class="nano-msg" role="status" aria-live="polite"></div><div class="nano-keys"></div>';
    el.addEventListener('keydown', nanoKey);
    el.querySelector('.nano-text').addEventListener('input', nanoMod);
    tBox.appendChild(el);
    nanoEl = el;
    return el;
  }
  function nanoMod() {
    if (nn && !nn.modified) { nn.modified = true; nn.mod.textContent = 'Modified'; }
  }
  function nanoTitle() {
    tTitle.textContent = '';
    var b = document.createElement('b');
    b.textContent = 'guest@arif';
    tTitle.appendChild(b);
    tTitle.appendChild(document.createTextNode(': nano ' + (nn.path || '')));
  }
  function nanoSay(text) {
    nn.msg.className = 'nano-msg';
    nn.msg.textContent = '';
    if (text) {
      var s = document.createElement('span');
      s.className = 'pill';
      s.textContent = text;
      nn.msg.appendChild(s);
    }
  }
  function nanoKeys(items) {
    nn.keysEl.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nk';
      var k = document.createElement('b');
      k.textContent = it[0];
      b.appendChild(k);
      b.appendChild(document.createTextNode(it[1]));
      b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
      b.addEventListener('click', it[2]);
      nn.keysEl.appendChild(b);
    });
  }
  function nanoEdit() {
    nn.mode = 'edit';
    function a(n) { return function () { nanoAct(n); }; }
    nanoKeys([['^G', 'Help', a('help')], ['^O', 'Write Out', a('write')], ['^W', 'Where Is', a('where')], ['^K', 'Cut', a('cut')], ['^X', 'Exit', a('exit')], ['^U', 'Paste', a('paste')]]);
    nn.ta.focus();
  }
  function nanoAsk(label, init, cb) {
    nn.mode = 'prompt';
    var m = nn.msg;
    m.className = 'nano-msg asking';
    m.textContent = '';
    var lab = document.createElement('span');
    lab.className = 'lab';
    lab.textContent = label;
    var inp = document.createElement('input');
    inp.className = 'nano-in';
    inp.type = 'text';
    inp.value = init || '';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.setAttribute('autocapitalize', 'none');
    inp.setAttribute('aria-label', label);
    m.appendChild(lab);
    m.appendChild(inp);
    function done(ok) {
      var v = inp.value;
      nanoSay('');
      nanoEdit();
      if (ok) cb(v); else nanoSay('[ Cancelled ]');
    }
    inp.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      else if (ev.key === 'Escape' || (ev.ctrlKey && ev.key.toLowerCase() === 'c')) { ev.preventDefault(); done(false); }
    });
    nanoKeys([['^C', 'Cancel', function () { done(false); }], ['↵', 'Accept', function () { done(true); }]]);
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
  function nanoYn(which) {
    var h = nn.yn;
    nanoSay('');
    nanoEdit();
    if (which === 'y') h.yes(); else if (which === 'n') h.no();
  }
  function nanoConfirm(text, yes, no) {
    nn.mode = 'yn';
    nn.yn = { yes: yes, no: no };
    nn.msg.className = 'nano-msg asking';
    nn.msg.textContent = text;
    nanoKeys([['Y', 'Yes', function () { nanoYn('y'); }], ['N', 'No', function () { nanoYn('n'); }], ['^C', 'Cancel', function () { nanoYn('c'); }]]);
  }
  function nanoClose() {
    var r = nn.resolve;
    nn.el.hidden = true;
    tBox.classList.remove('nano-open');
    nn = null;
    r('');
  }
  function nanoWrite(name, after) {
    name = String(name).trim();
    if (!name) { nanoSay('[ Cancelled ]'); return; }
    var ex = lookup(name);
    if (ex && ex.t === 'd') { nanoSay('[ Error writing ' + name + ': Is a directory ]'); return; }
    var text = nn.ta.value;
    if (text && text.slice(-1) !== '\n') text += '\n';
    try { writeFile(name, text, false); }
    catch (e) { nanoSay('[ Error writing ' + name + ': ' + e.message + ' ]'); return; }
    save();
    nn.path = name;
    nn.modified = false;
    nn.mod.textContent = '';
    nn.nameEl.textContent = name;
    nanoTitle();
    var n = lines(text).length;
    nanoSay('[ Wrote ' + n + ' line' + (n === 1 ? '' : 's') + ' ]');
    if (after) after();
  }
  function nanoFind(q) {
    if (!q) return;
    nn.q = q;
    var ta = nn.ta, hay = ta.value.toLowerCase(), nd = q.toLowerCase(), wrapped = false;
    var i = hay.indexOf(nd, ta.selectionEnd);
    if (i < 0) { i = hay.indexOf(nd); wrapped = i >= 0; }
    if (i < 0) { nanoSay('"' + q + '" not found'); return; }
    ta.focus();
    ta.setSelectionRange(i, i + q.length);
    var ln = ta.value.slice(0, i).split('\n').length - 1, lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    ta.scrollTop = Math.max(0, ln * lh - ta.clientHeight / 2);
    nanoSay(wrapped ? '[ Search Wrapped ]' : '');
  }
  function nanoAct(a) {
    if (!nn || nn.mode !== 'edit') return;
    var ta = nn.ta, v = ta.value, s = ta.selectionStart;
    var chain = nn.lastCut && a === 'cut';
    nn.lastCut = false;
    var ls = s === 0 ? 0 : v.lastIndexOf('\n', s - 1) + 1;
    if (a === 'help') {
      nanoSay('[ ^O Write Out   ^X Exit   ^K Cut line   ^U Paste   ^W or F6 Search ]');
    } else if (a === 'write') {
      nanoAsk('File Name to Write: ', nn.path || '', function (val) { nanoWrite(val); });
    } else if (a === 'where') {
      nanoAsk('Search: ', nn.q || '', nanoFind);
    } else if (a === 'cut') {
      var le = v.indexOf('\n', s);
      le = le < 0 ? v.length : le + 1;
      var line = v.slice(ls, le);
      if (!line) { nanoSay('[ Nothing was cut ]'); return; }
      if (line.slice(-1) !== '\n') line += '\n';
      nn.cut = (chain ? nn.cut : '') + line;
      ta.setRangeText('', ls, le, 'start');
      nanoMod();
      nn.lastCut = true;
    } else if (a === 'paste') {
      if (!nn.cut) { nanoSay('[ Cutbuffer is empty ]'); return; }
      var at = nn.cut.slice(-1) === '\n' ? ls : s;
      ta.setRangeText(nn.cut, at, at, 'end');
      nanoMod();
    } else if (a === 'exit') {
      if (!nn.modified) { nanoClose(); return; }
      nanoConfirm('Save modified buffer?  (Answering "No" will DISCARD changes.)', function () {
        if (nn.path) nanoWrite(nn.path, nanoClose);
        else nanoAsk('File Name to Write: ', '', function (val) { nanoWrite(val, nanoClose); });
      }, nanoClose);
    }
  }
  function nanoKey(ev) {
    if (!nn) return;
    var k = ev.key, kl = k.length === 1 ? k.toLowerCase() : k, ctrl = ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (nn.mode === 'yn') {
      ev.preventDefault();
      if (kl === 'y') nanoYn('y');
      else if (kl === 'n') nanoYn('n');
      else if (k === 'Escape' || (ctrl && kl === 'c')) nanoYn('c');
      return;
    }
    if (nn.mode !== 'edit') return;
    var act = null;
    if (ctrl && kl === 'o') act = 'write';
    else if (ctrl && kl === 'x') act = 'exit';
    else if (ctrl && kl === 'k') act = 'cut';
    else if (ctrl && kl === 'u') act = 'paste';
    else if ((ctrl && kl === 'w') || k === 'F6') act = 'where';
    else if ((ctrl && kl === 'g') || k === 'F1') act = 'help';
    if (act) { ev.preventDefault(); nanoAct(act); return; }
    if (k === 'Tab' && !ev.shiftKey && !ctrl) {
      ev.preventDefault();
      nn.ta.setRangeText('    ', nn.ta.selectionStart, nn.ta.selectionEnd, 'end');
      nanoMod();
      return;
    }
    if (!ctrl && !ev.metaKey && !ev.altKey && (k.length === 1 || k === 'Enter' || k === 'Backspace' || k === 'Delete')) { nn.lastCut = false; nanoSay(''); }
  }
  def('nano', 'text editor: nano [file]', function (args) {
    var p = args.filter(function (a) { return a.charAt(0) !== '-'; })[0] || null;
    var text = '', isNew = true;
    if (p) {
      var n = lookup(p);
      if (n && n.t === 'd') throw new Error('Error reading ' + p + ': Is a directory');
      if (n) { text = n.d; isNew = false; }
      else if (!parentOf(p)) throw new Error("Directory '" + p.replace(/\/[^\/]*$/, '') + "' does not exist");
    }
    return new Promise(function (resolve) {
      var el = nanoBuild();
      nn = { el: el, ta: el.querySelector('.nano-text'), msg: el.querySelector('.nano-msg'), keysEl: el.querySelector('.nano-keys'), nameEl: el.querySelector('.nano-name'), mod: el.querySelector('.nano-mod'), path: p, modified: false, cut: '', lastCut: false, mode: 'edit', q: '', resolve: resolve };
      nn.ta.value = text;
      nn.mod.textContent = '';
      nn.nameEl.textContent = p || 'New Buffer';
      el.hidden = false;
      tBox.classList.add('nano-open');
      nanoTitle();
      nanoEdit();
      var cnt = text ? lines(text).length : 0;
      nanoSay(isNew ? (p ? '[ New File ]' : '') : '[ Read ' + cnt + ' line' + (cnt === 1 ? '' : 's') + ' ]');
      nn.ta.scrollTop = 0;
      nn.ta.setSelectionRange(0, 0);
      nn.ta.focus();
    });
  });

  // ----- misc -----
  def('help', 'list the commands', function () {
    return nl([
      'Portfolio   about  skills  services  projects  contact  hire  goto',
      'Files       ls  cd  pwd  cat  echo  touch  mkdir  rmdir  rm  cp  mv  tree  find  nano',
      'Text        head  tail  wc  grep  sort  uniq',
      'Network     curl   (a real request from your browser; only servers that allow CORS answer)',
          '            curl  shows the options, curl <url>  fetches a page',
      'Python      python   (real Python in your browser; downloads on first use)',
      '            python  |  python file.py  |  python -c "print(2**100)"',
      'JavaScript  node   (JavaScript in a sandboxed Web Worker; not real Node.js: no DOM, no network, Ctrl+C stops it)',
      '            node  |  node file.js  |  node -e "console.log(2 ** 10)"  |  node -p "[1, 2, 3].map(x => x * 2)"',
      'Other       clear  history  type  date  whoami  uname  reset  help',
      '',
      'Pipes ( | ), redirects ( > and >> ), ";" , quotes and * ? globs work.',
      'Files live in your localStorage. "reset" restores the originals.',
      'Tab completes. Up/down walk the history. Ctrl+C cancels, Ctrl+L clears.'
    ]);
  });
  def('clear', 'clear the screen', function () { tOut.textContent = ''; return ''; });
  def('history', 'show command history', function () {
    return nl(hist.map(function (h, i) { return String(i + 1).padStart(4) + '  ' + h; }));
  });
  def('type', 'describe a command', function (args) {
    var out = [], errs = [];
    args.forEach(function (a) { if (cmds.has(a)) out.push(a + ' is a shell builtin'); else errs.push('type: ' + a + ': not found'); });
    return { out: nl(out), err: errs.join('\n') };
  });
  def('date', 'current date and time', function () { return new Date().toString() + '\n'; });
  def('whoami', 'current user', function () { return 'guest\n'; });
  def('uname', 'system name', function () { return 'arif-portfolio-shell (JavaScript, running in your browser)\n'; });
  def('reset', 'restore the original files', function () { root = seed(); cwd = HOME; return 'Filesystem restored.\n'; });
  def('sudo', '', function () { return 'guest is not in the sudoers file. This incident will be reported.\n'; }, true);
  def('exit', '', function () { return 'There is nowhere to go. This is a web page.\n'; }, true);

  // ----- parsing and execution -----
  function tokenize(s) {
    var out = [], cur = '', has = false, q = null, glob = false;
    function push() { if (has) out.push({ v: cur, g: glob }); cur = ''; has = false; glob = false; }
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) {
        if (ch === q) q = null;
        else if (q === '"' && ch === '\\' && i + 1 < s.length && '"\\$'.indexOf(s.charAt(i + 1)) > -1) cur += s.charAt(++i);
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (ch === '\\' && i + 1 < s.length) { cur += s.charAt(++i); has = true; continue; }
      if (/\s/.test(ch)) { push(); continue; }
      if (ch === '|' || ch === ';') { push(); out.push({ op: ch }); continue; }
      if (ch === '>') {
        push();
        if (s.charAt(i + 1) === '>') { out.push({ op: '>>' }); i++; } else out.push({ op: '>' });
        continue;
      }
      if (ch === '*' || ch === '?') glob = true;
      cur += ch; has = true;
    }
    if (q) throw new Error('unexpected EOF while looking for matching quote');
    push();
    return out;
  }
  function expandGlob(t) {
    if (!t.g) return [t.v];
    var i = t.v.lastIndexOf('/'), dpath = i >= 0 ? t.v.slice(0, i + 1) : '', pat = t.v.slice(i + 1);
    var d = lookup(dpath || '.');
    if (!d || d.t !== 'd') return [t.v];
    var re = globRe(pat);
    var m = Object.keys(d.c).filter(function (n) { return re.test(n) && (n.charAt(0) !== '.' || pat.charAt(0) === '.'); }).sort();
    return m.length ? m.map(function (n) { return dpath + n; }) : [t.v];
  }
  async function runStage(words, stdin, tty) {
    var c = cmds.get(words[0]);
    if (!c) return { out: '', err: words[0] + ': command not found' };
    try {
      var r = await c.fn(words.slice(1), { stdin: stdin, tty: tty });
      if (typeof r === 'string') return { out: r, err: '' };
      return { out: (r && r.out) || '', err: (r && r.err) || '' };
    } catch (e) {
      return { out: '', err: words[0] + ': ' + (e && e.message ? e.message : e) };
    }
  }
  async function execLine(text) {
    var shown = [];
    function show(str, cls) {
      var s = String(str);
      if (s.slice(-1) === '\n') s = s.slice(0, -1);
      shown.push(s);
      emit(s.split('\n'), cls);
    }
    var toks;
    try { toks = tokenize(text); } catch (e) { show('shell: ' + e.message, 'err'); return shown; }
    var pipelines = [[]];
    toks.forEach(function (t) { if (t.op === ';') pipelines.push([]); else pipelines[pipelines.length - 1].push(t); });
    for (var pi = 0; pi < pipelines.length; pi++) {
      var pl = pipelines[pi];
      if (!pl.length) continue;
      var stages = [[]];
      pl.forEach(function (t) { if (t.op === '|') stages.push([]); else stages[stages.length - 1].push(t); });
      var data = null, bad = false;
      for (var si = 0; si < stages.length && !bad; si++) {
        var st = stages[si], words = [], redir = null;
        for (var k = 0; k < st.length; k++) {
          var t = st[k];
          if (t.op === '>' || t.op === '>>') {
            var nx = st[k + 1];
            if (!nx || nx.op) { show("shell: syntax error near unexpected token '" + t.op + "'", 'err'); bad = true; break; }
            redir = { mode: t.op, path: nx.v };
            k++;
          } else expandGlob(t).forEach(function (w) { words.push(w); });
        }
        if (bad) break;
        var isLast = si === stages.length - 1;
        if (!words.length) {
          if (redir) {
            try { writeFile(redir.path, '', redir.mode === '>>'); } catch (e) { show('shell: ' + redir.path + ': ' + e.message, 'err'); }
            data = '';
            continue;
          }
          show("shell: syntax error near unexpected token '|'", 'err');
          bad = true;
          break;
        }
        var res = await runStage(words, data, isLast && !redir);
        if (res.err) show(res.err, 'err');
        if (redir) {
          try { writeFile(redir.path, res.out, redir.mode === '>>'); } catch (e) { show('shell: ' + redir.path + ': ' + e.message, 'err'); }
          data = '';
        } else if (isLast) {
          if (res.out !== '') show(res.out);
        } else data = res.out;
      }
    }
    return shown;
  }
  async function run(raw) {
    if (busy) return;
    if (repl) return replLine(raw);
    var text = String(raw).trim();
    if (!text) return;
    busy = true;
    var hadFocus = document.activeElement === tIn;
    tRow.hidden = true;
    hist.push(text);
    hpos = hist.length;
    var p = promptStr();
    renderEcho(p, text);
    var shown = [];
    try { shown = await execLine(text); }
    catch (e) { shown = ['shell: ' + (e && e.message ? e.message : e)]; emit(shown, 'err'); }
    busy = false;
    tRow.hidden = false;
    if (hadFocus) tIn.focus({ preventScroll: true });
    if (!save() && !warned) {
      warned = true;
      emit(['shell: could not save to localStorage (full or blocked). Changes last until you reload.'], 'err');
    }
    setPrompt();
    tScroll.scrollTop = tScroll.scrollHeight;
    if (text.split(/\s+/)[0] !== 'clear') console.log('%c%s%c%s', 'color:#9DB0C8', p + ' ' + text, '', '\n' + shown.join('\n'));
  }

  // ----- input handling -----
  function commonPrefix(arr) {
    var p = arr[0];
    arr.forEach(function (s) { while (s.indexOf(p) !== 0) p = p.slice(0, -1); });
    return p;
  }
  function complete() {
    var v = tIn.value;
    if (!/\s/.test(v)) {
      var m = visibleNames().filter(function (n) { return n.indexOf(v) === 0; });
      if (m.length === 1) tIn.value = m[0] + ' ';
      else if (m.length > 1) {
        var cp = commonPrefix(m);
        if (cp.length > v.length) tIn.value = cp;
        else { renderEcho(promptStr(), v); emit([m.join('   ')]); }
      }
      return;
    }
    var idx = v.search(/\S*$/), word = v.slice(idx), si = word.lastIndexOf('/');
    var dpart = si >= 0 ? word.slice(0, si + 1) : '', pre = word.slice(si + 1);
    var d = lookup(dpart || '.');
    if (!d || d.t !== 'd') return;
    var names = Object.keys(d.c).filter(function (n) { return n.indexOf(pre) === 0 && (pre || n.charAt(0) !== '.') && !/\s/.test(n); }).sort();
    if (!names.length) return;
    if (names.length === 1) {
      tIn.value = v.slice(0, idx) + dpart + names[0] + (d.c[names[0]].t === 'd' ? '/' : ' ');
    } else {
      var cp2 = commonPrefix(names);
      if (cp2.length > pre.length) tIn.value = v.slice(0, idx) + dpart + cp2;
      else {
        renderEcho(promptStr(), v);
        emit([names.map(function (n) { return n + (d.c[n].t === 'd' ? '/' : ''); }).join('  ')]);
      }
    }
  }
  tIn.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault(); // otherwise the Enter keypress lands in an editor opened by this very command
      if (busy) return;
      var v = tIn.value;
      tIn.value = '';
      run(v);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (hpos > 0) hpos--;
      tIn.value = hist[hpos] || '';
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (hpos < hist.length) hpos++;
      tIn.value = hist[hpos] || '';
    } else if (ev.key === 'Tab') {
      if (repl) { ev.preventDefault(); tIn.setRangeText('    ', tIn.selectionStart, tIn.selectionEnd, 'end'); return; }
      if (!tIn.value) return;
      ev.preventDefault();
      complete();
    } else if (ev.ctrlKey && ev.key.toLowerCase() === 'd' && repl && !tIn.value) {
      ev.preventDefault();
      renderEcho(psOf(), '');
      endRepl();
      setPrompt();
      tScroll.scrollTop = tScroll.scrollHeight;
    } else if (ev.ctrlKey && ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      tOut.textContent = '';
    } else if (ev.ctrlKey && ev.key.toLowerCase() === 'c' && !(window.getSelection && String(window.getSelection()))) {
      ev.preventDefault();
      if (curlAbort) curlAbort.abort();
      else {
        if (repl) {
          renderEcho(psOf(), tIn.value + '^C');
          emit(repl.kind === 'node' ? [] : ['KeyboardInterrupt'], 'err');
          repl.more = false;
          repl.rt.reset();
          setPrompt();
        } else renderEcho(promptStr(), tIn.value + '^C');
        tIn.value = '';
        tScroll.scrollTop = tScroll.scrollHeight;
      }
    }
  });
  // While a command runs the prompt row is hidden, so Ctrl+C is caught on the document
  document.addEventListener('keydown', function (ev) {
    if (busy && curlAbort && ev.ctrlKey && ev.key.toLowerCase() === 'c' && !(window.getSelection && String(window.getSelection()))) {
      ev.preventDefault();
      curlAbort.abort();
    }
  });
  // Custom 2px caret that follows the text cursor
  var tCaret = document.getElementById('term-caret');
  var mctx = document.createElement('canvas').getContext('2d');
  function moveCaret() {
    var pos = tIn.selectionStart == null ? tIn.value.length : tIn.selectionStart;
    mctx.font = getComputedStyle(tIn).font;
    var sc = tIn.offsetWidth ? tIn.getBoundingClientRect().width / tIn.offsetWidth : 1;
    var w = (mctx.measureText(tIn.value.slice(0, pos)).width - tIn.scrollLeft) * sc;
    tCaret.style.transform = 'translateX(' + Math.max(0, w) + 'px)';
    tCaret.style.animation = 'none';
    void tCaret.offsetWidth;
    tCaret.style.animation = '';
  }
  function soon() { requestAnimationFrame(moveCaret); }
  ['input', 'keydown', 'keyup', 'click', 'focus', 'select', 'mouseup'].forEach(function (e) { tIn.addEventListener(e, soon); });
  moveCaret();

  tBox.addEventListener('click', function (ev) {
    if (nn) return;
    if (ev.target.closest('a, button')) return;
    if (window.getSelection && String(window.getSelection())) return;
    tIn.focus({ preventScroll: true });
  });

  // DevTools side: portfolio.ls('-l'), portfolio.cat('README.md'), portfolio.run('curl -s https://...')
  var api = {};
  function q1(a) { return "'" + String(a).replace(/'/g, "'\\''") + "'"; }
  visibleNames().forEach(function (n) {
    api[n] = function () { return run([n].concat([].slice.call(arguments).map(q1)).join(' ')); };
  });
  api.run = function (s) { return run(String(s)); };
  window.portfolio = api;
  console.log('%cHey 👋 curious about the code?%c\nThe terminal near the bottom of the page shares a command registry with this console. Try portfolio.run("ls") or portfolio.help()', 'font:600 14px sans-serif;color:#9DB0C8', '');

  if (!storageOK) emit(['(localStorage is unavailable here, so files will not survive a reload.)'], 'err');
  setPrompt();

  // Login banner, like a real shell session
  (function () {
    var d = new Date();
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var stamp = days[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + String(d.getDate()).padStart(2) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    emit(['Last login: ' + stamp + ' on ttys001'], 'dim');
    emit(['Welcome to arif-portfolio-shell 1.0 (JavaScript, running in your browser)', '']);
    emit(['Type help to see all commands, or try about, skills, services, contact.']);
  })();
})();