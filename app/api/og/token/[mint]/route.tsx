import { ImageResponse } from 'next/og';
import { getEnv } from '@/lib/env';
import { tokenReport } from '@/lib/service';
import { isAddress } from '@/lib/solana/address';
import type { Grade } from '@/lib/scan/types';

export const dynamic = 'force-dynamic';

const GRADE_COLOR: Record<Grade, string> = { LOW: '#3FBF7F', ELEVATED: '#F0A53A', HIGH: '#D63B3B', CRITICAL: '#FF2D2D' };

async function logoDataUri(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith('https://')) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 400_000) return null;
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

/** GET /api/og/token/<mint>: the shareable risk card (1200x630) used by X, Telegram and Discord previews. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isAddress(mint)) return new Response('Invalid address', { status: 400 });
  const { env, ctx: cf } = await getEnv();
  const r = await tokenReport(env, cf, mint).catch(() => null);
  const grade: Grade = r?.risk.grade ?? 'ELEVATED';
  const color = GRADE_COLOR[grade];
  const flags = (r?.findings ?? []).filter((f) => f.weight > 0).slice(0, 3);
  const logo = await logoDataUri(r?.token.image ?? null);
  const title = r ? `${r.token.name ?? 'Unknown token'}${r.token.symbol ? ` ($${r.token.symbol})` : ''}` : 'Token scan';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', backgroundColor: '#050303', color: '#F4F1F1', padding: '52px 60px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>
            <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 14, backgroundColor: '#D63B3B', marginRight: 14 }} />
            RugHawk
          </div>
          <div style={{ display: 'flex', fontSize: 18, color: '#9C9293', letterSpacing: 2 }}>SOLANA FORENSIC SCAN</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={120} height={120} style={{ borderRadius: 24, marginRight: 36, border: '2px solid #302C2D' }} alt="" />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', fontSize: title.length > 28 ? 46 : 58, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: 'flex', fontSize: 22, color: '#9C9293', marginTop: 10, fontFamily: 'monospace' }}>{`${mint.slice(0, 6)}...${mint.slice(-6)}`}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 230, height: 230, borderRadius: 230, border: `10px solid ${color}`, backgroundColor: '#150F10' }}>
            <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, color }}>{r ? String(r.risk.score) : '?'}</div>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, letterSpacing: 2, color }}>{grade}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {flags.length ? (
            flags.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', fontSize: 25, marginTop: 10 }}>
                <div style={{ display: 'flex', width: 10, height: 10, borderRadius: 10, backgroundColor: f.severity === 'critical' ? '#FF2D2D' : f.severity === 'high' ? '#D63B3B' : '#F0A53A', marginRight: 16 }} />
                {f.title.length > 80 ? `${f.title.slice(0, 77)}...` : f.title}
              </div>
            ))
          ) : (
            <div style={{ display: 'flex', fontSize: 25, color: '#3FBF7F' }}>No structural red flags found.</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, fontSize: 18, color: '#9C9293' }}>
            <div style={{ display: 'flex' }}>Spot the rug before it is pulled.</div>
            <div style={{ display: 'flex' }}>rughawk.com</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  );
}
