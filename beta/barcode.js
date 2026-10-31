// Barcode decoding: native BarcodeDetector where available (Android Chrome), ZXing elsewhere (iPhone).
let decoderPromise;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

export function getDecoder() {
  decoderPromise ??= (async () => {
    if ("BarcodeDetector" in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.length) {
          const detector = new window.BarcodeDetector({ formats });
          return async (canvas) => {
            try {
              const found = await detector.detect(canvas);
              return found[0]?.rawValue ?? null;
            } catch {
              return null;
            }
          };
        }
      } catch {}
    }
    const Z = await import("./vendor/zxing.js");
    const reader = new Z.MultiFormatReader();
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.EAN_13,
      Z.BarcodeFormat.EAN_8,
      Z.BarcodeFormat.UPC_A,
      Z.BarcodeFormat.UPC_E,
      Z.BarcodeFormat.CODE_128,
    ]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    return async (canvas) => {
      try {
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decodeWithState(bitmap).getText();
      } catch {
        return null;
      }
    };
  })();
  return decoderPromise;
}
