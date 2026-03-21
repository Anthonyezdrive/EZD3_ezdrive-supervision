/**
 * B2B Export utilities — CSV and PDF generation for B2B portal reports
 */

// ── CSV Export ─────────────────────────────────────────────

/**
 * Convert an array of objects to a CSV string and trigger download.
 */
export function exportCSV(
  rows: Record<string, string | number>[],
  headers: { key: string; label: string }[],
  filename: string
) {
  const sep = ";"; // French Excel-friendly separator
  const headerLine = headers.map((h) => h.label).join(sep);
  const dataLines = rows.map((row) =>
    headers
      .map((h) => {
        const val = row[h.key];
        if (val == null) return "";
        // Wrap strings containing separator or quotes
        const str = String(val);
        if (str.includes(sep) || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(sep)
  );

  const bom = "\uFEFF"; // UTF-8 BOM for Excel
  const csv = bom + [headerLine, ...dataLines].join("\n");
  downloadBlob(csv, filename, "text/csv;charset=utf-8");
}

// ── PDF Export ─────────────────────────────────────────────

export interface PDFTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: number; // relative weight
}

/**
 * Generate a simple PDF table report and trigger download.
 * Uses canvas-based approach for zero dependencies.
 */
export function exportPDF(
  title: string,
  subtitle: string,
  columns: PDFTableColumn[],
  rows: Record<string, string | number>[],
  filename: string,
  options?: {
    totalsRow?: Record<string, string | number>;
    kpis?: { label: string; value: string }[];
  }
) {
  // A4 dimensions in points (72dpi)
  const W = 595.28;
  const H = 841.89;
  const margin = 40;
  const contentW = W - margin * 2;

  // Calculate column widths
  const totalWeight = columns.reduce((s, c) => s + (c.width ?? 1), 0);
  const colWidths = columns.map((c) => ((c.width ?? 1) / totalWeight) * contentW);

  // PDF primitives
  const objects: string[] = [];
  const pages: string[] = [];
  const currentPage = "";
  let yPos = H - margin;

  const addObj = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const resetPage = () => {
    yPos = H - margin - 60; // leave room for header
  };

  const needNewPage = (height: number) => yPos - height < margin + 20;

  // Text drawing helpers
  const textCmd = (x: number, y: number, text: string, fontSize: number, bold = false) => {
    const safeTxt = text
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, (ch) => {
        // Map common French chars to Windows-1252
        const map: Record<string, string> = {
          "é": "\\351", "è": "\\350", "ê": "\\352", "ë": "\\353",
          "à": "\\340", "â": "\\342", "ä": "\\344",
          "ù": "\\371", "û": "\\373", "ü": "\\374",
          "ô": "\\364", "ö": "\\366",
          "î": "\\356", "ï": "\\357",
          "ç": "\\347",
          "€": "\\200",
          "°": "\\260",
          "\u2014": "-", "\u2013": "-", "\u2019": "'",
        };
        return map[ch] ?? "?";
      });
    const font = bold ? "/F2" : "/F1";
    return `BT ${font} ${fontSize} Tf ${x} ${y} Td (${safeTxt}) Tj ET\n`;
  };

  const lineCmd = (x1: number, y1: number, x2: number, y2: number, width = 0.5) =>
    `${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;

  const rectFillCmd = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) =>
    `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`;

  const colorCmd = (r: number, g: number, b: number) => `${r} ${g} ${b} rg\n`;
  const strokeColorCmd = (r: number, g: number, b: number) => `${r} ${g} ${b} RG\n`;

  // Build page content
  const buildPageContent = () => {
    let stream = "";

    // Header bar
    stream += rectFillCmd(0, H - 50, W, 50, 0.059, 0.071, 0.208); // #0F1235
    stream += rectFillCmd(0, H - 52, W, 2, 0.604, 0.800, 0.055); // #9ACC0E

    // Header text
    stream += colorCmd(1, 1, 1);
    stream += textCmd(margin, H - 35, title, 11, true);
    stream += colorCmd(0.69, 0.72, 0.83);
    stream += textCmd(W - margin - 120, H - 35, `EZDrive Business`, 8);

    // Subtitle
    stream += colorCmd(0.4, 0.45, 0.55);
    stream += textCmd(margin, H - 72, subtitle, 9);

    // Reset color
    stream += colorCmd(0, 0, 0);

    return stream;
  };

  // Draw KPIs
  const drawKPIs = (kpis: { label: string; value: string }[]) => {
    let stream = "";
    const kpiW = contentW / kpis.length;
    const kpiH = 40;
    const kpiY = yPos - kpiH;

    kpis.forEach((kpi, i) => {
      const x = margin + i * kpiW;
      stream += strokeColorCmd(0.85, 0.87, 0.9);
      stream += `0.5 w ${x + 2} ${kpiY} ${kpiW - 4} ${kpiH} re S\n`;
      stream += colorCmd(0.12, 0.16, 0.23);
      stream += textCmd(x + 8, kpiY + 22, kpi.value, 12, true);
      stream += colorCmd(0.5, 0.55, 0.65);
      stream += textCmd(x + 8, kpiY + 8, kpi.label, 7);
    });

    yPos = kpiY - 15;
    return stream;
  };

  // Draw table header
  const drawTableHeader = () => {
    let stream = "";
    const rowH = 22;
    const headerY = yPos - rowH;

    stream += rectFillCmd(margin, headerY, contentW, rowH, 0.059, 0.071, 0.208);
    stream += colorCmd(1, 1, 1);

    let xOff = margin;
    columns.forEach((col, i) => {
      const textX = col.align === "right" ? xOff + colWidths[i] - 6 : xOff + 6;
      stream += textCmd(textX, headerY + 7, col.label, 7, true);
      xOff += colWidths[i];
    });

    yPos = headerY;
    return stream;
  };

  // Draw table row
  const drawTableRow = (row: Record<string, string | number>, isAlt: boolean, isTotals = false) => {
    let stream = "";
    const rowH = 18;
    const rowY = yPos - rowH;

    if (isTotals) {
      stream += rectFillCmd(margin, rowY, contentW, rowH, 0.93, 0.95, 0.97);
    } else if (isAlt) {
      stream += rectFillCmd(margin, rowY, contentW, rowH, 0.97, 0.98, 0.99);
    }

    // Grid line
    stream += strokeColorCmd(0.9, 0.91, 0.93);
    stream += lineCmd(margin, rowY, margin + contentW, rowY, 0.3);

    stream += colorCmd(0.12, 0.16, 0.23);

    let xOff = margin;
    columns.forEach((col, i) => {
      const val = String(row[col.key] ?? "");
      const truncated = val.length > 30 ? val.substring(0, 28) + "..." : val;
      const fontSize = isTotals ? 7.5 : 7;
      const textX = col.align === "right" ? xOff + colWidths[i] - 6 : xOff + 6;
      stream += textCmd(textX, rowY + 5, truncated, fontSize, isTotals);
      xOff += colWidths[i];
    });

    yPos = rowY;
    return stream;
  };

  // Build all pages
  let pageStream = buildPageContent();
  yPos = H - margin - 60;

  // KPIs
  if (options?.kpis?.length) {
    pageStream += drawKPIs(options.kpis);
  }

  // Table header
  pageStream += drawTableHeader();

  // Table rows
  rows.forEach((row, i) => {
    if (needNewPage(20)) {
      pages.push(pageStream);
      pageStream = buildPageContent();
      resetPage();
      pageStream += drawTableHeader();
    }
    pageStream += drawTableRow(row, i % 2 === 1);
  });

  // Totals row
  if (options?.totalsRow) {
    if (needNewPage(20)) {
      pages.push(pageStream);
      pageStream = buildPageContent();
      resetPage();
      pageStream += drawTableHeader();
    }
    pageStream += drawTableRow(options.totalsRow, false, true);
  }

  // Footer
  pageStream += colorCmd(0.5, 0.55, 0.65);
  pageStream += textCmd(margin, 25, `Rapport genere le ${new Date().toLocaleDateString("fr-FR")} — EZDrive Business`, 6);

  pages.push(pageStream);

  // ── Assemble PDF ──
  const pdf = assemblePDF(pages, objects, addObj);
  downloadBlob(pdf, filename, "application/pdf");
}

function assemblePDF(
  pageStreams: string[],
  _objects: string[],
  _addObj: (s: string) => number
): string {
  // Simple PDF 1.4 generator
  const objs: { offset: number; content: string }[] = [];
  let body = "";

  const addObject = (content: string) => {
    const id = objs.length + 1;
    objs.push({ offset: 0, content: `${id} 0 obj\n${content}\nendobj\n` });
    return id;
  };

  // 1. Catalog
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");

  // 2. Pages (placeholder, updated later)
  const pagesId = addObject(""); // placeholder

  // 3-4. Fonts
  const font1Id = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const font2Id = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  // Create page objects
  const pageIds: number[] = [];
  for (const stream of pageStreams) {
    const streamBytes = new TextEncoder().encode(stream);
    const streamId = addObject(
      `<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  }

  // Update pages object
  const kidsStr = pageIds.map((id) => `${id} 0 R`).join(" ");
  objs[pagesId - 1].content = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageIds.length} >>\nendobj\n`;

  // Build PDF
  body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];

  for (const obj of objs) {
    offsets.push(body.length);
    body += obj.content;
  }

  // xref
  const xrefOffset = body.length;
  body += `xref\n0 ${objs.length + 1}\n`;
  body += `0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, "0")} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;

  return body;
}

// ── Invoice PDF Export ────────────────────────────────────

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  periodLabel: string;
  // Company info
  clientName: string;
  clientSlug: string;
  clientAddress?: string;
  // Billing
  redevanceRate: number;
  lines: {
    description: string;
    quantity: number;
    unitLabel: string;
    unitPrice: number;
    total: number;
  }[];
  totalHT: number;
  tvaRate: number;
  totalTVA: number;
  totalTTC: number;
}

/**
 * Generate a professional invoice PDF and trigger download.
 * Uses the same canvas-based approach as exportPDF.
 */
export function exportInvoicePDF(invoice: InvoiceData, filename: string) {
  const W = 595.28;
  const H = 841.89;
  const margin = 40;
  const contentW = W - margin * 2;

  const pages: string[] = [];
  let yPos = H - margin;

  const textCmd = (x: number, y: number, text: string, fontSize: number, bold = false) => {
    const safeTxt = text
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, (ch) => {
        const map: Record<string, string> = {
          "é": "\\351", "è": "\\350", "ê": "\\352", "ë": "\\353",
          "à": "\\340", "â": "\\342", "ä": "\\344",
          "ù": "\\371", "û": "\\373", "ü": "\\374",
          "ô": "\\364", "ö": "\\366",
          "î": "\\356", "ï": "\\357",
          "ç": "\\347", "€": "\\200", "°": "\\260",
          "N°": "N\\260",
          "\u2014": "-", "\u2013": "-", "\u2019": "'",
        };
        return map[ch] ?? "?";
      });
    const font = bold ? "/F2" : "/F1";
    return `BT ${font} ${fontSize} Tf ${x} ${y} Td (${safeTxt}) Tj ET\n`;
  };

  const lineCmd = (x1: number, y1: number, x2: number, y2: number, width = 0.5) =>
    `${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;

  const rectFillCmd = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) =>
    `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`;

  const colorCmd = (r: number, g: number, b: number) => `${r} ${g} ${b} rg\n`;
  const strokeColorCmd = (r: number, g: number, b: number) => `${r} ${g} ${b} RG\n`;

  let stream = "";

  // ── Header bar ──
  stream += rectFillCmd(0, H - 60, W, 60, 0.059, 0.071, 0.208); // dark header
  stream += rectFillCmd(0, H - 62, W, 2, 0.604, 0.800, 0.055); // green accent

  // Header text
  stream += colorCmd(1, 1, 1);
  stream += textCmd(margin, H - 30, "FACTURE", 18, true);
  stream += colorCmd(0.604, 0.800, 0.055);
  stream += textCmd(margin, H - 48, "EZDrive Business", 9, true);
  stream += colorCmd(0.69, 0.72, 0.83);
  stream += textCmd(W - margin - 160, H - 30, `N ${invoice.invoiceNumber}`, 10, true);
  stream += textCmd(W - margin - 160, H - 44, `Date: ${invoice.invoiceDate}`, 8);

  yPos = H - 90;

  // ── Emitter info (EZDrive) ──
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(margin, yPos, "Emetteur", 7, true);
  yPos -= 14;
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(margin, yPos, "EZDrive SAS", 9, true);
  yPos -= 12;
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(margin, yPos, "Service de supervision de bornes de recharge", 7);
  yPos -= 12;
  stream += textCmd(margin, yPos, "contact@ezdrive.fr", 7);

  // ── Client info (right side) ──
  const rightX = W / 2 + 20;
  let rightY = H - 90;
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(rightX, rightY, "Client", 7, true);
  rightY -= 14;
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(rightX, rightY, invoice.clientName, 9, true);
  rightY -= 12;
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(rightX, rightY, `Ref: ${invoice.clientSlug}`, 7);
  if (invoice.clientAddress) {
    rightY -= 12;
    stream += textCmd(rightX, rightY, invoice.clientAddress, 7);
  }
  rightY -= 12;
  stream += textCmd(rightX, rightY, `Periode: ${invoice.periodLabel}`, 7);

  yPos -= 30;

  // ── Separator ──
  stream += strokeColorCmd(0.85, 0.87, 0.9);
  stream += lineCmd(margin, yPos, margin + contentW, yPos, 0.5);
  yPos -= 20;

  // ── Invoice title ──
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(margin, yPos, `Facture de redevance - ${invoice.periodLabel}`, 11, true);
  yPos -= 8;
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(margin, yPos, `Taux de redevance: ${(invoice.redevanceRate * 100).toFixed(1)}%`, 8);
  yPos -= 25;

  // ── Line items table header ──
  const colWidths = [contentW * 0.4, contentW * 0.12, contentW * 0.12, contentW * 0.18, contentW * 0.18];
  const colX = [margin, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2], margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3]];

  stream += rectFillCmd(margin, yPos - 18, contentW, 18, 0.059, 0.071, 0.208);
  stream += colorCmd(1, 1, 1);
  stream += textCmd(colX[0] + 6, yPos - 13, "Description", 7, true);
  stream += textCmd(colX[1] + 6, yPos - 13, "Quantite", 7, true);
  stream += textCmd(colX[2] + 6, yPos - 13, "Unite", 7, true);
  stream += textCmd(colX[3] + 6, yPos - 13, "Prix unit.", 7, true);
  stream += textCmd(colX[4] + 6, yPos - 13, "Total", 7, true);
  yPos -= 18;

  // ── Line items ──
  stream += colorCmd(0.12, 0.16, 0.23);
  invoice.lines.forEach((line, i) => {
    if (i % 2 === 1) {
      stream += rectFillCmd(margin, yPos - 18, contentW, 18, 0.97, 0.98, 0.99);
    }
    stream += strokeColorCmd(0.9, 0.91, 0.93);
    stream += lineCmd(margin, yPos - 18, margin + contentW, yPos - 18, 0.3);
    stream += colorCmd(0.12, 0.16, 0.23);
    stream += textCmd(colX[0] + 6, yPos - 13, line.description, 7);
    stream += textCmd(colX[1] + 6, yPos - 13, fmtNum(line.quantity, 2), 7);
    stream += textCmd(colX[2] + 6, yPos - 13, line.unitLabel, 7);
    stream += textCmd(colX[3] + 6, yPos - 13, `${fmtNum(line.unitPrice, 4)} EUR`, 7);
    stream += textCmd(colX[4] + 6, yPos - 13, `${fmtNum(line.total, 2)} EUR`, 7, true);
    yPos -= 18;
  });

  yPos -= 10;
  stream += strokeColorCmd(0.85, 0.87, 0.9);
  stream += lineCmd(margin, yPos, margin + contentW, yPos, 0.5);
  yPos -= 20;

  // ── Totals section ──
  const totalsX = margin + contentW - 200;
  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(totalsX, yPos, "Total HT", 8);
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(totalsX + 120, yPos, `${fmtNum(invoice.totalHT, 2)} EUR`, 8, true);
  yPos -= 16;

  stream += colorCmd(0.4, 0.45, 0.55);
  stream += textCmd(totalsX, yPos, `TVA (${(invoice.tvaRate * 100).toFixed(1)}%)`, 8);
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(totalsX + 120, yPos, `${fmtNum(invoice.totalTVA, 2)} EUR`, 8);
  yPos -= 16;

  stream += strokeColorCmd(0.604, 0.800, 0.055);
  stream += lineCmd(totalsX, yPos + 4, totalsX + 200, yPos + 4, 1);
  stream += colorCmd(0.12, 0.16, 0.23);
  stream += textCmd(totalsX, yPos - 8, "Total TTC", 10, true);
  stream += colorCmd(0.059, 0.071, 0.208);
  stream += textCmd(totalsX + 120, yPos - 8, `${fmtNum(invoice.totalTTC, 2)} EUR`, 10, true);
  yPos -= 30;

  // ── Payment terms ──
  stream += colorCmd(0.5, 0.55, 0.65);
  stream += textCmd(margin, yPos, "Conditions de paiement: 30 jours date de facture", 7);
  yPos -= 12;
  stream += textCmd(margin, yPos, "Paiement par virement bancaire", 7);

  // ── Footer ──
  stream += colorCmd(0.5, 0.55, 0.65);
  stream += textCmd(margin, 30, `EZDrive SAS - Facture generee automatiquement le ${new Date().toLocaleDateString("fr-FR")}`, 6);
  stream += textCmd(W - margin - 80, 30, "Page 1/1", 6);

  pages.push(stream);

  // Assemble PDF
  const pdf = assemblePDF(pages, [], () => 0);
  downloadBlob(pdf, filename, "application/pdf");
}

function fmtNum(n: number, dec: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── Download helper ────────────────────────────────────────

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
