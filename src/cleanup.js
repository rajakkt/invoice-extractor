const fs = require("fs");
const path = require("path");

const DIRS_TO_CLEAN = [
  path.join(__dirname, "..", "input"),
  path.join(__dirname, "..", "output", "processed"),
  path.join(__dirname, "..", "output", "needs_review"),
  path.join(__dirname, "..", "output", "daily_summaries")
];

function cleanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      cleanDirectory(filePath); // recursive delete
      fs.rmdirSync(filePath);
    } else {
      fs.unlinkSync(filePath);
    }
  }
}

console.log("?? Cleaning up generated files...\n");

for (const dir of DIRS_TO_CLEAN) {
  cleanDirectory(dir);
  console.log(`? Cleaned: ${dir.split(/[\/\\]/).slice(-1)[0]}/`);
}

console.log("\n? Cleanup complete! Ready for fresh test.");
