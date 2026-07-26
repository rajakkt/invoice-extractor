const { extractText } = require("./src/extractPdf");
const path = require("path");

async function test() {
  const pdfPath = "C:\\Users\\rajak\\Downloads\\invoices\\Emerson Invoice 20031881 PO 260425.pdf";
  const text = await extractText(pdfPath);
  
  // Find lines with amounts
  const lines = text.split("\n");
  console.log("Lines containing amounts or subtotal/total:");
  lines.forEach((line, i) => {
    if (line.match(/subtotal|total|2101|1320|amount|sum/i)) {
      console.log(`Line ${i}: ${line}`);
    }
  });
  
  console.log("\n\nFirst 2000 chars:\n");
  console.log(text.substring(0, 2000));
}

test();
