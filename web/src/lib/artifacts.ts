export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'link'; href: string; label: string };

// Group 1/2 = image alt/src (![alt](src)); group 3/4 = link label/href ([label](href)).
const TOKEN = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseArtifacts(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(content)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: content.slice(last, m.index) });
    if (m[2] !== undefined) {
      out.push({ kind: 'image', alt: m[1] ?? '', src: m[2] });
    } else {
      out.push({ kind: 'link', label: m[3] ?? '', href: m[4]! });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ kind: 'text', value: content.slice(last) });
  return out;
}

export function resolveSrc(src: string, sessionId: string): string {
  if (/^(https?:|data:)/i.test(src)) return src;
  const clean = src.replace(/^\.?\//, '');
  const enc = clean.split('/').map(encodeURIComponent).join('/');
  return `/api/file/${encodeURIComponent(sessionId)}/${enc}`;
}

export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(p.split('?')[0]);
}

export function isPdfPath(p: string): boolean {
  return /\.pdf$/i.test(p.split('?')[0]);
}
