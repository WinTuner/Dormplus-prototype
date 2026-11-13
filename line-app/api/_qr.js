// One QR renderer for the room QR (/api/qr) and the owner invite QR (/api/owner).
//
// - container "svg-viewbox": the SVG carries a viewBox and no fixed size, so CSS can shrink it to
//   the phone's width and it scales. Without a viewBox a 360px SVG drawn at 280px is cropped, the
//   finder squares are cut off and phones cannot scan it.
// - join: the dark modules become one path (a few KB instead of ~80KB of <rect>s, and no hairline
//   seams between modules when scaled).
// - padding 4: the 4-module quiet zone the QR standard asks for.
// - no XML declaration: the SVG is placed inline in HTML.
// Required lazily so `node smoke.js` runs without node_modules.
function qrSvg(content) {
  const QR = require("qrcode-svg");
  return new QR({
    content,
    padding: 4,
    width: 256,
    height: 256,
    ecl: "M",
    container: "svg-viewbox",
    join: true,
    xmlDeclaration: false,
  }).svg();
}

module.exports = { qrSvg };
