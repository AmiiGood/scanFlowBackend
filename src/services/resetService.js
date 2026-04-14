const pool = require("../config/database");

// Reset completo de una caja:
// - Borra escaneos con caja_id
// - Resetea QRs a disponible
// - Resetea caja a abierta
// - Si estaba en un cartón, desliga la caja y resetea el cartón a pendiente
async function resetCaja(caja_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cajaRows } = await client.query(
      "SELECT * FROM cajas WHERE id = $1",
      [caja_id],
    );
    if (!cajaRows[0]) throw { status: 404, message: "Caja no encontrada" };
    const caja = cajaRows[0];

    // Resetear QRs escaneados en esta caja a disponible
    await client.query(
      `UPDATE codigos_qr SET estado = 'disponible'
       WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = $1)`,
      [caja_id],
    );

    // Borrar escaneos de la caja
    const { rowCount } = await client.query(
      "DELETE FROM escaneos WHERE caja_id = $1",
      [caja_id],
    );

    // Si la caja estaba en un cartón, resetear el cartón también
    if (caja.carton_id) {
      await client.query(
        "UPDATE cartones SET estado = 'pendiente' WHERE id = $1",
        [caja.carton_id],
      );
    }

    // Resetear la caja
    await client.query(
      "UPDATE cajas SET estado = 'abierta', carton_id = NULL WHERE id = $1",
      [caja_id],
    );

    await client.query("COMMIT");
    return { escaneos_borrados: rowCount, caja_id: parseInt(caja_id) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reset de un cartón:
// - Borra escaneos con carton_id (musicales)
// - Resetea QRs de esos escaneos a escaneado (vuelven a producción)
// - Desliga todas las cajas del cartón y las resetea a empacada
// - Resetea el cartón a pendiente
async function resetCarton(carton_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cartonRows } = await client.query(
      "SELECT * FROM cartones WHERE id = $1",
      [carton_id],
    );
    if (!cartonRows[0]) throw { status: 404, message: "Cartón no encontrado" };

    // Escaneos musicales (carton_id directo) → QRs vuelven a escaneado
    await client.query(
      `UPDATE codigos_qr SET estado = 'escaneado'
       WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE carton_id = $1)`,
      [carton_id],
    );

    const { rowCount: musicalBorrados } = await client.query(
      "DELETE FROM escaneos WHERE carton_id = $1",
      [carton_id],
    );

    // Cajas que estaban en este cartón → desligar y volver a empacada
    const { rowCount: cajasBorradas } = await client.query(
      "UPDATE cajas SET carton_id = NULL, estado = 'empacada' WHERE carton_id = $1",
      [carton_id],
    );

    // Resetear el cartón
    await client.query(
      "UPDATE cartones SET estado = 'pendiente' WHERE id = $1",
      [carton_id],
    );

    await client.query("COMMIT");
    return {
      carton_id: parseInt(carton_id),
      escaneos_musicales_borrados: musicalBorrados,
      cajas_desligadas: cajasBorradas,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reset de una PO completa:
// - Reset de todos los cartones de la PO
// - Reset de todas las cajas de esos cartones
// - Resetea estado de la PO a pendiente
async function resetPO(po_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: poRows } = await client.query(
      "SELECT * FROM purchase_orders WHERE id = $1",
      [po_id],
    );
    if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };

    // Obtener todos los cartones de la PO
    const { rows: cartones } = await client.query(
      "SELECT id FROM cartones WHERE po_id = $1",
      [po_id],
    );
    const cartonIds = cartones.map((c) => c.id);

    let escaneosMusicales = 0;
    let cajasDesligadas = 0;
    let escaneosCajas = 0;

    if (cartonIds.length) {
      // Escaneos musicales → QRs a escaneado
      await client.query(
        `UPDATE codigos_qr SET estado = 'escaneado'
         WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE carton_id = ANY($1))`,
        [cartonIds],
      );
      const { rowCount: em } = await client.query(
        "DELETE FROM escaneos WHERE carton_id = ANY($1)",
        [cartonIds],
      );
      escaneosMusicales = em;

      // Cajas ligadas a esos cartones
      const { rows: cajas } = await client.query(
        "SELECT id FROM cajas WHERE carton_id = ANY($1)",
        [cartonIds],
      );
      const cajaIds = cajas.map((c) => c.id);

      if (cajaIds.length) {
        // QRs de esas cajas → disponible
        await client.query(
          `UPDATE codigos_qr SET estado = 'disponible'
           WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = ANY($1))`,
          [cajaIds],
        );
        const { rowCount: ec } = await client.query(
          "DELETE FROM escaneos WHERE caja_id = ANY($1)",
          [cajaIds],
        );
        escaneosCajas = ec;

        // Resetear cajas
        await client.query(
          "UPDATE cajas SET estado = 'abierta', carton_id = NULL WHERE id = ANY($1)",
          [cajaIds],
        );
        cajasDesligadas = cajaIds.length;
      }

      // Resetear cartones
      await client.query(
        "UPDATE cartones SET estado = 'pendiente' WHERE id = ANY($1)",
        [cartonIds],
      );
    }

    // Resetear PO
    await client.query(
      "UPDATE purchase_orders SET estado = 'pendiente' WHERE id = $1",
      [po_id],
    );

    await client.query("COMMIT");
    return {
      po_id: parseInt(po_id),
      cartones_reseteados: cartonIds.length,
      cajas_desligadas: cajasDesligadas,
      escaneos_musicales_borrados: escaneosMusicales,
      escaneos_cajas_borrados: escaneosCajas,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { resetCaja, resetCarton, resetPO };
