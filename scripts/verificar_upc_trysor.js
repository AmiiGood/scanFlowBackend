// Pide a Trysor los QRs desde una fecha y muestra el UPC tal como llega, sin
// tocar la BD. Sirve para comprobar si el UPC dañado ("1.91E+11") viene de Trysor.
//
//   node scripts/verificar_upc_trysor.js "2026-10-19 00:00:00"
//
// Guarda la respuesta cruda en scripts/respuesta_trysor_<fecha>.txt
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { callApi } = require("../src/services/trysorService");

const UPC_VALIDO = /^\d{12,14}$/;

(async () => {
  const lastGetTime = process.argv[2];
  if (!lastGetTime) {
    console.log('Uso: node scripts/verificar_upc_trysor.js "AAAA-MM-DD HH:MM:SS"');
    process.exit(1);
  }

  const response = await callApi(
    process.env.TRYSOR_API_URL,
    "get_crocs_qr_upc",
    process.env.TRYSOR_APP_KEY,
    process.env.TRYSOR_APP_SECRET,
    { LastGetTime: lastGetTime },
  );

  // Data llega como texto JSON: ese texto es exactamente lo que mandó Trysor.
  const crudo = typeof response.Data === "string" ? response.Data : JSON.stringify(response.Data);
  const archivo = path.join(__dirname, `respuesta_trysor_${lastGetTime.replace(/\D/g, "")}.txt`);
  fs.writeFileSync(archivo, crudo);

  const items = JSON.parse(crudo);
  const tipos = {};
  const malos = new Map();
  for (const it of items) {
    tipos[typeof it.UPC] = (tipos[typeof it.UPC] || 0) + 1;
    const upc = String(it.UPC ?? "");
    if (!UPC_VALIDO.test(upc)) {
      if (!malos.has(upc)) malos.set(upc, []);
      malos.get(upc).push(it.QrCode);
    }
  }

  console.log(`\nQRs recibidos: ${items.length.toLocaleString()}`);
  console.log("Tipo del campo UPC:", tipos, "(string = viene entre comillas)");
  console.log(`UPCs inválidos: ${[...malos.values()].reduce((a, l) => a + l.length, 0).toLocaleString()}`);
  for (const [upc, qrs] of malos) {
    console.log(`  ${JSON.stringify(upc).padEnd(18)} ${String(qrs.length).padStart(7)} QRs  ej. ${qrs[0]}`);
  }

  // Un ejemplo literal del texto recibido, para mandárselo a Trysor.
  const [primero] = malos.values();
  if (primero) {
    const i = crudo.indexOf(primero[0]);
    console.log("\nTexto exacto recibido:\n ", crudo.slice(Math.max(0, i - 15), i + primero[0].length + 40));
  }
  console.log(`\nRespuesta completa guardada en ${archivo}`);
})().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
