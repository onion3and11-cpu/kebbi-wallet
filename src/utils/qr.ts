import QRCode from 'qrcode';

/**
 * Generate QR Code as Data URL string (image/png base64)
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 2,
    width: 360,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

/**
 * Generate QR Code as PNG Uint8Array (pure JS, works in Node and Cloudflare Workers)
 */
export async function generateQrPngBuffer(text: string): Promise<Uint8Array> {
  const dataUrl = await generateQrDataUrl(text);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64');
  }

  // Pure Edge / Worker binary conversion
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
