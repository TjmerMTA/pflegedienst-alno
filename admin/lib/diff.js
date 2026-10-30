// Line diff (LCS) for the revision screen. Files are small; large inputs fall back to a plain listing.
export function lineDiff(a, b, maxLines = 3000) {
  const A = String(a).split('\n'); const B = String(b).split('\n');
  if (A.length * B.length > maxLines * maxLines) {
    return [...A.map((text) => ({ op: 'del', text })), ...B.map((text) => ({ op: 'add', text }))];
  }
  const n = A.length; const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: 'same', text: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: 'del', text: A[i++] });
    else out.push({ op: 'add', text: B[j++] });
  }
  while (i < n) out.push({ op: 'del', text: A[i++] });
  while (j < m) out.push({ op: 'add', text: B[j++] });
  return out;
}

// Keeps changed lines with `context` lines around them; long unchanged runs become «…».
export function compact(diff, context = 3) {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((d, i) => { if (d.op !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true; });
  const out = [];
  let skipped = false;
  diff.forEach((d, i) => {
    if (keep[i]) { out.push(d); skipped = false; } else if (!skipped) { out.push({ op: 'skip', text: '…' }); skipped = true; }
  });
  return out;
}
