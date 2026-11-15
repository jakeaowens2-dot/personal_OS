import { readFileSync, writeFileSync } from "node:fs";

const [output, ...inputs] = process.argv.slice(2);
const types = ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"];
if (!output || inputs.length !== types.length) throw new Error("Provide an output and PNGs at 16, 32, 64, 128, 256, 512, and 1024 pixels.");
const chunks = inputs.map((path, index) => {
  const image = readFileSync(path);
  const chunk = Buffer.alloc(image.length + 8);
  chunk.write(types[index], 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  image.copy(chunk, 8);
  return chunk;
});
const length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(length, 4);
writeFileSync(output, Buffer.concat([header, ...chunks], length));
