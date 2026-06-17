import { describe, it, expect } from 'vitest';
import { parseArtifacts, resolveSrc, isImagePath, isPdfPath } from './artifacts';

describe('parseArtifacts', () => {
  it('returns a single text segment for plain prose', () => {
    expect(parseArtifacts('hello world')).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('parses a markdown image', () => {
    expect(parseArtifacts('![a shot](.deck-artifacts/shot.png)')).toEqual([
      { kind: 'image', alt: 'a shot', src: '.deck-artifacts/shot.png' },
    ]);
  });

  it('keeps surrounding text and preserves order', () => {
    expect(parseArtifacts('see ![](x.png) here')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'image', alt: '', src: 'x.png' },
      { kind: 'text', value: ' here' },
    ]);
  });

  it('parses a markdown link as a link segment', () => {
    expect(parseArtifacts('[report.pdf](.deck-artifacts/report.pdf)')).toEqual([
      { kind: 'link', label: 'report.pdf', href: '.deck-artifacts/report.pdf' },
    ]);
  });

  it('handles multiple tokens', () => {
    const segs = parseArtifacts('![](a.png) and [b](b.zip)');
    expect(segs.map((s) => s.kind)).toEqual(['image', 'text', 'link']);
  });
});

describe('resolveSrc', () => {
  it('rewrites a relative path to the file route', () => {
    expect(resolveSrc('.deck-artifacts/shot.png', 'sid1')).toBe('/api/file/sid1/.deck-artifacts/shot.png');
  });
  it('strips a leading ./', () => {
    expect(resolveSrc('./x.png', 'sid1')).toBe('/api/file/sid1/x.png');
  });
  it('encodes path segments', () => {
    expect(resolveSrc('dir name/a b.png', 'sid1')).toBe('/api/file/sid1/dir%20name/a%20b.png');
  });
  it('passes http(s) URLs through unchanged', () => {
    expect(resolveSrc('https://example.com/x.png', 'sid1')).toBe('https://example.com/x.png');
  });
  it('passes data URLs through unchanged', () => {
    expect(resolveSrc('data:image/png;base64,AAAA', 'sid1')).toBe('data:image/png;base64,AAAA');
  });
});

describe('type predicates', () => {
  it('detects image extensions', () => {
    expect(isImagePath('a.PNG')).toBe(true);
    expect(isImagePath('a.jpeg')).toBe(true);
    expect(isImagePath('a.pdf')).toBe(false);
  });
  it('detects pdf', () => {
    expect(isPdfPath('a.PDF')).toBe(true);
    expect(isPdfPath('a.png')).toBe(false);
  });
});
