const path = require("path");
const p = require(path.join(__dirname, "..", "package-lock.json"));
const has = !!p.packages["node_modules/@react-google-maps/api"];
console.log("Lock has @react-google-maps/api:", has);
if (!has) {
  console.log("Need to run: npm install @react-google-maps/api");
}
