
/**
 * Converts a base64 string to a Uint8Array.
 * Handles standard base64 decoding.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64.replace(/\s/g, ''));
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts raw PCM 16-bit integers (from Gemini) to an AudioBuffer (for Browser).
 * Gemini Live Output: 24kHz, 1 channel, PCM Int16 Little Endian.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> {
  // Create a DataView to ensure we read Little Endian correctly
  const dataView = new DataView(data.buffer);
  const numSamples = data.byteLength / 2; // 2 bytes per sample (16-bit)
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < numSamples; i++) {
    // getInt16(byteOffset, littleEndian)
    const int16 = dataView.getInt16(i * 2, true); 
    // Normalize to [-1.0, 1.0]
    channelData[i] = int16 < 0 ? int16 / 32768.0 : int16 / 32767.0;
  }
  
  return buffer;
}

/**
 * Converts Browser Audio (Float32) to PCM Int16 Base64 (for Gemini Input).
 * Gemini Live Input: 16kHz, 1 channel, PCM Int16 Little Endian.
 */
export function float32ToB64PCM(float32Array: Float32Array): string {
  const int16Array = new Int16Array(float32Array.length);
  const len = float32Array.length;

  for (let i = 0; i < len; i++) {
    // Clamp between -1 and 1
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    // Convert to 16-bit integer
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // Convert Int16Array buffer to binary string
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  const bytesLen = bytes.byteLength;
  for (let i = 0; i < bytesLen; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return btoa(binary);
}
