# Third-party notices

## OCRAD.js

The Assistant's experimental card-index scanner uses OCRAD.js to read the rank glyph locally in the browser. OCRAD.js is a rule-based OCR engine; it does not use a generative AI service or send camera frames to a server.

- Project: https://github.com/antimatter15/ocrad.js
- Author: Kevin Kwok
- License: GNU General Public License, version 3; see `vendor/ocrad/LICENSE`.
- The bundled `vendor/ocrad/ocrad.js` is used without modification.

Suit recognition is performed separately from the card-corner shape in `assistant-scan.mjs`.
