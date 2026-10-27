// EPC-QR / GiroCode (EPC069-12, bản 002) + bộ mã QR mức M — bản JavaScript của Invoice/Domain/Payment/{QRCode,EPCQR,BankDetails}.swift.
// Chạy hoàn toàn trong trình duyệt: không gửi IBAN hay số tiền đi đâu. Kiểm từng module với shared/fixtures/payment_cases.json:
//   node tools/web/test_epc.cjs
(function (root) {
  "use strict";

  // ---- BankDetails ----
  var SEPA = ["AD","AT","BE","BG","CH","CY","CZ","DE","DK","EE","ES","FI","FR","GB","GI","GR","HR","HU","IE","IS","IT",
    "LI","LT","LU","LV","MC","MT","NL","NO","PL","PT","RO","SE","SI","SK","SM","VA"];
  var IBAN_LENGTHS = { AD:24, AT:20, BE:16, BG:22, CH:21, CY:28, CZ:24, DE:22, DK:18, EE:20, ES:24, FI:18, FR:27, GB:22, GI:23,
    GR:27, HR:21, HU:28, IE:22, IS:26, IT:27, LI:21, LT:20, LU:20, LV:21, MC:27, MT:31, NL:18, NO:15, PL:28, PT:25, RO:24,
    SE:24, SI:19, SK:24, SM:27, VA:22 };

  function compact(v) { return String(v).replace(/\s+/g, "").toUpperCase(); }

  function mod97(v) {
    var rem = 0;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i), d;
      if (c >= 48 && c <= 57) d = c - 48; else if (c >= 65 && c <= 90) d = c - 55; else return -1;
      rem = d >= 10 ? (rem * 100 + d) % 97 : (rem * 10 + d) % 97;
    }
    return rem;
  }

  function isValidIBAN(v) {
    var iban = compact(v);
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    var len = IBAN_LENGTHS[iban.slice(0, 2)];
    if (len && iban.length !== len) return false;
    return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
  }
  function isSEPAIBAN(v) { return isValidIBAN(v) && SEPA.indexOf(compact(v).slice(0, 2)) >= 0; }
  function isValidBIC(v) { return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(v)); }
  function groups(v) { return v.replace(/(.{4})/g, "$1 ").trim(); }

  // ---- CreditorReference (ISO 11649) ----
  function makeRF(reference) {
    var body = String(reference).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!body || body.length > 21) return null;
    var check = 98 - mod97(body + "RF00");
    return "RF" + (check < 10 ? "0" : "") + check + body;
  }
  function isValidRF(v) {
    var ref = compact(v);
    return /^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(ref) && mod97(ref.slice(4) + ref.slice(0, 4)) === 1;
  }

  // ---- EPC ----
  var ALLOWED = /[A-Za-z0-9\/\-?:().,'+ ]/;
  var SPECIAL = { "ß":"ss", "Æ":"AE", "æ":"ae", "Ø":"O", "ø":"o", "Œ":"OE", "œ":"oe", "Đ":"D", "đ":"d", "Ð":"D", "ð":"d",
    "Ł":"L", "ł":"l", "Þ":"TH", "þ":"th", "&":"+" };

  // Chữ theo bộ ký tự SEPA cơ bản: bỏ dấu, vài chữ ghép, ký tự khác thành khoảng trắng.
  function sepaText(value) {
    var out = "";
    var s = String(value).normalize("NFD");
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (/\p{Mn}/u.test(ch)) continue;
      out += ALLOWED.test(ch) ? ch : (SPECIAL[ch] || " ");
    }
    return out.replace(/ {2,}/g, " ").trim();
  }

  function amountText(minor) { var c = minor % 100; return Math.floor(minor / 100) + "." + (c < 10 ? "0" : "") + c; }

  function utf8Length(s) { return new TextEncoder().encode(s).length; }

  /**
   * opts: { name, iban, bic, amountMinor (cent, có thể null = để trống), reference, autoRF }
   * autoRF = true: giống app (biến số chứng từ thành RF khi được). false: chỉ dùng RF khi người dùng đã nhập RF hợp lệ.
   * Trả { ok: payload } hoặc { error: "epc.iban" | "epc.amount" | "epc.name" | "epc.tooLong" }.
   */
  function build(opts) {
    if (!isSEPAIBAN(opts.iban || "")) return { error: "epc.iban" };
    var minor = opts.amountMinor;
    if (minor != null && !(minor >= 1 && minor <= 99999999999)) return { error: "epc.amount" };
    var beneficiary = sepaText(opts.name || "").slice(0, 70).trim();
    if (!beneficiary) return { error: "epc.name" };
    var reference = opts.reference || "";
    var rf = opts.autoRF ? makeRF(reference) : (isValidRF(reference) ? compact(reference) : null);
    var bic = compact(opts.bic || "");
    var lines = ["BCD", "002", "1", "SCT", isValidBIC(bic) ? bic : "", beneficiary, compact(opts.iban),
      minor == null ? "" : "EUR" + amountText(minor), "", rf || "", rf ? "" : sepaText(reference).slice(0, 140).trim()];
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    var payload = lines.join("\n");
    if (utf8Length(payload) > 331) return { error: "epc.tooLong" };
    return { ok: payload };
  }

  // ---- QR (ISO/IEC 18004, chế độ byte, mức M) ----
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLOCK_COUNTS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function countBits(v) { return v <= 9 ? 8 : 16; }
  function rawDataModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(v) { return Math.floor(rawDataModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCK_COUNTS[v]; }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(degree) {
    var r = new Array(degree).fill(0); r[degree - 1] = 1; var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = new Array(div.length).fill(0);
    data.forEach(function (b) {
      var f = b ^ r[0]; r.shift(); r.push(0);
      for (var i = 0; i < r.length; i++) r[i] ^= gfMul(div[i], f);
    });
    return r;
  }
  function interleave(version, data) {
    var blockCount = BLOCK_COUNTS[version], eccLen = ECC_PER_BLOCK[version];
    var raw = Math.floor(rawDataModules(version) / 8);
    var shortBlocks = blockCount - raw % blockCount, shortLen = Math.floor(raw / blockCount);
    var div = rsDivisor(eccLen), k = 0, blocks = [];
    for (var i = 0; i < blockCount; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      blocks.push((i < shortBlocks ? dat.concat([0]) : dat).concat(ecc));
    }
    var out = [];
    for (var p = 0; p < blocks[0].length; p++)
      for (var q = 0; q < blocks.length; q++)
        if (p !== shortLen - eccLen || q >= shortBlocks) out.push(blocks[q][p]);
    return out;
  }

  function QR(version) {
    this.version = version; this.size = version * 4 + 17;
    this.m = []; this.f = [];
    for (var y = 0; y < this.size; y++) { this.m.push(new Array(this.size).fill(false)); this.f.push(new Array(this.size).fill(false)); }
  }
  QR.prototype.set = function (x, y, d) { this.m[y][x] = d; this.f[y][x] = true; };
  QR.prototype.finder = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= this.size || yy >= this.size) continue;
      var dist = Math.max(Math.abs(dx), Math.abs(dy));
      this.set(xx, yy, dist !== 2 && dist !== 4);
    }
  };
  QR.prototype.alignment = function () {
    if (this.version === 1) return [];
    var count = Math.floor(this.version / 7) + 2;
    var step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    var r = new Array(count).fill(0); r[0] = 6;
    for (var i = count - 1, pos = this.size - 7; i >= 1; i--, pos -= step) r[i] = pos;
    return r;
  };
  QR.prototype.formatBits = function (mask) {
    var data = mask, rem = data; // mức M = 00
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412, s = this.size;
    var bit = function (i) { return ((bits >>> i) & 1) !== 0; };
    for (i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  };
  QR.prototype.versionBits = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem;
    for (i = 0; i < 18; i++) {
      var d = ((bits >>> i) & 1) !== 0, a = this.size - 11 + i % 3, b = Math.floor(i / 3);
      this.set(a, b, d); this.set(b, a, d);
    }
  };
  QR.prototype.functionPatterns = function () {
    for (var i = 0; i < this.size; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(this.size - 4, 3); this.finder(3, this.size - 4);
    var p = this.alignment(), n = p.length;
    for (i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        this.set(p[i] + dx, p[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.formatBits(0);
    this.versionBits();
  };
  QR.prototype.codewords = function (data) {
    var i = 0, s = this.size;
    for (var right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < s; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? s - 1 - vert : vert;
        if (!this.f[y][x] && i < data.length * 8) { this.m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
  };
  QR.prototype.mask = function (mask) {
    for (var y = 0; y < this.size; y++) for (var x = 0; x < this.size; x++) {
      if (this.f[y][x]) continue;
      var inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = x * y % 2 + x * y % 3 === 0; break;
        case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
        default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
      if (inv) this.m[y][x] = !this.m[y][x];
    }
  };
  QR.prototype.penalty = function () {
    var self = this, s = this.size, result = 0;
    function addHistory(len, h) { h.pop(); h.unshift(h[0] === 0 ? len + s : len); }
    function finderLike(h) {
      var n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    }
    [true, false].forEach(function (horizontal) {
      for (var a = 0; a < s; a++) {
        var runColor = false, run = 0, h = [0, 0, 0, 0, 0, 0, 0];
        for (var b = 0; b < s; b++) {
          var dark = horizontal ? self.m[a][b] : self.m[b][a];
          if (dark === runColor) { run++; if (run === 5) result += 3; else if (run > 5) result += 1; }
          else { addHistory(run, h); if (!runColor) result += finderLike(h) * 40; runColor = dark; run = 1; }
        }
        if (runColor) { addHistory(run, h); run = 0; }
        addHistory(run + s, h);
        result += finderLike(h) * 40;
      }
    });
    for (var y = 0; y < s - 1; y++) for (var x = 0; x < s - 1; x++) {
      var c = this.m[y][x];
      if (c === this.m[y][x + 1] && c === this.m[y + 1][x] && c === this.m[y + 1][x + 1]) result += 3;
    }
    var darkCount = 0;
    this.m.forEach(function (row) { row.forEach(function (d) { if (d) darkCount++; }); });
    var total = s * s, k = Math.floor((Math.abs(darkCount * 20 - total * 10) + total - 1) / total) - 1;
    return result + k * 10;
  };
  QR.prototype.isDark = function (x, y) { return this.m[y][x]; };
  QR.prototype.rows = function () { return this.m.map(function (r) { return r.map(function (d) { return d ? "1" : "0"; }).join(""); }); };

  // Mã hoá chuỗi (UTF-8) thành QR; null khi quá dung lượng phiên bản 40.
  function encodeQR(text) {
    var data = Array.from(new TextEncoder().encode(text));
    var version = 0;
    for (var v = 1; v <= 40; v++) if (4 + countBits(v) + data.length * 8 <= dataCodewords(v) * 8) { version = v; break; }
    if (!version) return null;
    var capacity = dataCodewords(version) * 8, bits = [];
    function append(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
    append(4, 4);
    append(data.length, countBits(version));
    data.forEach(function (b) { append(b, 8); });
    append(0, Math.min(4, capacity - bits.length));
    append(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
    var cw = [];
    for (var i = 0; i < bits.length / 8; i++) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]; cw.push(b); }
    var qr = new QR(version);
    qr.functionPatterns();
    qr.codewords(interleave(version, cw));
    var best = 0, bestPenalty = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      qr.mask(mask); qr.formatBits(mask);
      var p = qr.penalty();
      if (p < bestPenalty) { best = mask; bestPenalty = p; }
      qr.mask(mask);
    }
    qr.mask(best); qr.formatBits(best);
    return qr;
  }

  // SVG có vùng trắng 4 module; mỗi module tối là một đoạn path.
  function toSVG(qr, px) {
    var quiet = 4, n = qr.size + quiet * 2, d = "";
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++)
      if (qr.isDark(x, y)) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" width="' + (px || n * 8) + '" height="' + (px || n * 8) +
      '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  var api = { compact: compact, isValidIBAN: isValidIBAN, isSEPAIBAN: isSEPAIBAN, isValidBIC: isValidBIC, groups: groups,
    makeRF: makeRF, isValidRF: isValidRF, sepaText: sepaText, build: build, encodeQR: encodeQR, toSVG: toSVG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.InvoiceEPC = api;
})(this);
