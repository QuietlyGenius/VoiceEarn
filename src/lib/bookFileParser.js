import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// Resolves an EPUB-internal relative path against the file that referenced it.
function resolveZipPath(basePath, relativePath) {
  const baseUrl = new URL(basePath, 'zip://root/');
  const resolvedUrl = new URL(relativePath, baseUrl);
  return decodeURIComponent(resolvedUrl.pathname.replace(/^\//, ''));
}

function median(nums) {
  const arr = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function looksLikeHeading(text) {
  const t = text.trim();
  if (t.length <= 60 && /^(chapter|part|prologue|epilogue|section|book|introduction|contents|preface|acknowledg)/i.test(t)) return true;
  if (t.length <= 45 && t === t.toUpperCase() && /[A-Za-z]/.test(t)) return true;
  return false;
}

// ---- PDF: reconstruct lines from item positions, then group lines into
// paragraphs by detecting larger-than-normal vertical gaps. Headings are
// marked with a leading "## ". ----
export async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageBlocks = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group text items into lines by their y-coordinate.
    const lines = [];
    let cur = null;
    for (const it of content.items) {
      if (!it.str) continue;
      const y = it.transform[5];
      if (cur && Math.abs(cur.y - y) < 4) {
        cur.text += (cur.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
      } else {
        if (cur) lines.push(cur);
        cur = { y, text: it.str };
      }
    }
    if (cur) lines.push(cur);

    const cleaned = lines
      .map((l) => ({ y: l.y, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text);
    if (!cleaned.length) continue;

    // Typical line spacing -> anything notably larger is a paragraph break.
    const gaps = [];
    for (let k = 1; k < cleaned.length; k++) gaps.push(cleaned[k - 1].y - cleaned[k].y);
    const med = median(gaps);

    const paras = [];
    let buf = [];
    for (let k = 0; k < cleaned.length; k++) {
      buf.push(cleaned[k].text);
      const gap = k + 1 < cleaned.length ? cleaned[k].y - cleaned[k + 1].y : Infinity;
      if (gap === Infinity || (med && gap > med * 1.6)) {
        paras.push(buf.join(' '));
        buf = [];
      }
    }

    const blocks = paras
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (looksLikeHeading(t) ? `## ${t}` : t));
    if (blocks.length) pageBlocks.push(blocks.join('\n\n'));
  }

  return pageBlocks.join('\n\n');
}

// ---- EPUB: walk the block-level elements of each chapter so paragraph and
// heading structure is preserved (EPUB content is HTML). ----
function extractStructuredFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  doc.body?.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach((el) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    blocks.push(/^h[1-6]$/i.test(el.tagName) ? `## ${text}` : text);
  });
  if (blocks.length === 0) {
    const t = (doc.body?.textContent || '').replace(/[ \t]+/g, ' ').trim();
    if (t) blocks.push(t);
  }
  return blocks.join('\n\n');
}

export async function extractEpubText(file) {
  const zip = await JSZip.loadAsync(file);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid EPUB: could not locate the content manifest');

  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error('Invalid EPUB: content manifest file is missing from the archive');

  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });

  const spineHrefs = Array.from(opfDoc.querySelectorAll('spine > itemref'))
    .map((ref) => manifest[ref.getAttribute('idref')])
    .filter(Boolean);

  if (spineHrefs.length === 0) throw new Error('Invalid EPUB: reading order (spine) is empty');

  const chapterTexts = [];
  for (const href of spineHrefs) {
    const fullPath = resolveZipPath(opfPath, href);
    const zipEntry = zip.file(fullPath);
    if (!zipEntry) continue;
    const html = await zipEntry.async('text');
    const text = extractStructuredFromHtml(html);
    if (text) chapterTexts.push(text);
  }

  return chapterTexts.join('\n\n');
}

export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfText(file);
  }
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    return extractEpubText(file);
  }
  throw new Error('Unsupported file type. Please upload a PDF or EPUB.');
}
