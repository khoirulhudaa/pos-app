// pdfHelper.js
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export async function extractTextFromPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Gabungkan tanpa menambah spasi berlebih
    const pageText = content.items
      .map((item) => item.str)
      .join("")          // ← penting: jangan pakai spasi
      .replace(/\s+/g, " "); // rapikan spasi ganda

    fullText += pageText + "\n";
  }
  return fullText;
}