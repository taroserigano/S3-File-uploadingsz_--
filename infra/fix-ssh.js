const fs = require("fs");

// Remove old known_hosts entry
const kh = "C:/Users/taro/.ssh/known_hosts";
if (fs.existsSync(kh)) {
  const lines = fs.readFileSync(kh, "utf8").split("\n");
  const filtered = lines.filter((l) => l.indexOf("54.167.52.78") === -1);
  fs.writeFileSync(kh, filtered.join("\n"));
  console.log("Removed old host key entry");
}

// Check and fix key file CRLF
const keyPath = "C:/Users/taro/.ssh/travel-app-debug.pem";
const key = fs.readFileSync(keyPath, "utf8");
console.log("Key length:", key.length);
console.log("First line:", key.split("\n")[0]);
console.log("Has CR:", key.includes("\r"));
if (key.includes("\r")) {
  fs.writeFileSync(keyPath, key.replace(/\r/g, ""));
  console.log("Fixed CRLF in key file");
}
