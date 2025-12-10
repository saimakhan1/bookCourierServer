const fs = require("fs");
const key = fs.readFileSync("./bookcourier-adminsdk.json");
const base64 = key.toString("base64");
console.log(base64);
