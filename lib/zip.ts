function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytes16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function bytes32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function zipStored(files: { name: string; data: Uint8Array }[]): Blob {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...bytes16(20),
      ...bytes16(0x0800),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes32(crc),
      ...bytes32(file.data.length),
      ...bytes32(file.data.length),
      ...bytes16(name.length),
      ...bytes16(0),
    ]);
    locals.push(local, name, file.data);

    central.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      ...bytes16(20),
      ...bytes16(20),
      ...bytes16(0x0800),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes32(crc),
      ...bytes32(file.data.length),
      ...bytes32(file.data.length),
      ...bytes16(name.length),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes16(0),
      ...bytes32(0),
      ...bytes32(offset),
    ]), name);

    offset += local.length + name.length + file.data.length;
  }

  let centralSize = 0;
  for (const part of central) centralSize += part.length;
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...bytes16(0),
    ...bytes16(0),
    ...bytes16(files.length),
    ...bytes16(files.length),
    ...bytes32(centralSize),
    ...bytes32(offset),
    ...bytes16(0),
  ]);

  const parts = [...locals, ...central, end].map((part) => {
    const copy = new ArrayBuffer(part.byteLength);
    new Uint8Array(copy).set(part);
    return copy;
  });
  return new Blob(parts, { type: "application/zip" });
}
