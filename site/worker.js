/* Range support for the hero videos.
 *
 * Workers static assets always answer 206-style Range requests with a 200 and
 * the whole file, which Safari refuses to treat as seekable media. This
 * worker runs first for /assets/vid/* only, fetches the asset, and slices the
 * requested byte range itself. Everything else is served as plain assets.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'ldorvadortravel.com' ||
        url.hostname === 'ldorvadortravel.org' ||
        url.hostname === 'www.ldorvadortravel.org') {
      url.hostname = 'www.ldorvadortravel.com';
      return Response.redirect(url.toString(), 301);
    }
    const asset = await env.ASSETS.fetch(request);
    if (url.hostname.endsWith('.workers.dev')) {
      const h = new Headers(asset.headers);
      h.set('X-Robots-Tag', 'noindex');
      return new Response(asset.body, { status: asset.status, headers: h });
    }
    const range = request.headers.get('Range');
    if (!asset.ok || !range) return asset;

    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) return asset;

    const buf = await asset.arrayBuffer();
    const size = buf.byteLength;
    let start, end;
    if (m[1] === '') {           // suffix form: bytes=-N (final N bytes)
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(buf.slice(start, end + 1), { status: 206, headers });
  },
};
