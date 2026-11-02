import { describe, expect, it } from 'vitest';
import {
  formatConfigTxt,
  formatTrackTxt,
  parseConfigTxt,
  parseTrackTxt,
  stemFromFilename,
} from '../src/library/trackfile';
import { encodeWav } from '../src/library/wav';

describe('stem file names', () => {
  it('follow the handheld numbering', () => {
    expect(['1.wav', '2.wav', '3.wav', '4.wav'].map(stemFromFilename)).toEqual(['other', 'vocals', 'bass', 'drums']);
  });
  it('recognise named stems and reject anything else', () => {
    expect(stemFromFilename('Song - Vocals.flac')).toBe('vocals');
    expect(stemFromFilename('melody.mp3')).toBe('other');
    expect(stemFromFilename('holiday.mp3')).toBe(null);
  });
});

describe('TRACK.txt', () => {
  it('round trips', () => {
    const t = parseTrackTxt(
      formatTrackTxt({
        title: 'A',
        bpm: 101,
        colours: [
          [1, 0, 0],
          [0, 0, 1],
        ],
        gainDb: -2,
      }),
    );
    expect(t).toEqual({
      title: 'A',
      bpm: 101,
      colours: [
        [1, 0, 0],
        [0, 0, 1],
      ],
      gainDb: -2,
    });
  });
  it('ignores nonsense', () => {
    expect(parseTrackTxt('tempo_bpm: 9000\nTrackColour: red\nno colon here')).toEqual({});
  });
});

describe('config.txt', () => {
  it('maps manual field names and round trips', () => {
    const c = parseConfigTxt('SeekJumpPeriod=500\nMinVolumeLevel: -40\nUnknown=1');
    expect(c).toEqual({ seekJumpMs: 500, minVolumeDb: -40 });
    expect(parseConfigTxt(formatConfigTxt(c as never)).seekJumpMs).toBe(500);
  });
});

describe('encodeWav', () => {
  it('writes a valid header and clamps', async () => {
    const buf = await encodeWav([new Float32Array([0, 2, -2])], 44100).arrayBuffer();
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 6);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });
});
