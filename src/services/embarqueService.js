const pool = require("../config/database");
const { normalizeQR, normalizeCodigoCaja } = require("./scanValidationService");

/**
 * Actualiza el estado de la PO según el estado de sus cartones.
 * - Todos completos -> 'completo'
 * - Al menos uno completo -> 'en_proceso'
 * - No toca POs en estado 'enviado' o 'cancelado'
 */
async function actualizarEstadoPO(client, carton_id) {
  const { rows } = await client.query(
    `SELECT c.po_id, po.cantidad_cartones,
       (SELECT COUNT(*) FROM cartones WHERE po_id = c.po_id) AS total,
       (SELECT COUNT(*) FROM cartones WHERE po_id = c.po_id AND estado = 'completo') AS completos
     FROM cartones c
     JOIN purchase_orders po ON po.id = c.po_id
     WHERE c.id = $1`,
    [carton_id],
  );
  if (!rows[0]) return;
  const { po_id, total, completos, cantidad_cartones } = rows[0];
  const totalInt = parseInt(total);
  const completosInt = parseInt(completos);

  const { rows: poRows } = await client.query(
    "SELECT estado FROM purchase_orders WHERE id = $1",
    [po_id],
  );
  const estadoActual = poRows[0]?.estado;
  if (!estadoActual || estadoActual === "enviado" || estadoActual === "cancelado")
    return;

  let nuevoEstado = estadoActual;
  // Con cartones sin importar (menos de los que dice su Excel) la PO no está
  // completa aunque todos los importados lo estén.
  if (totalInt > 0 && completosInt === totalInt && totalInt >= cantidad_cartones)
    nuevoEstado = "completo";
  else if (completosInt > 0) nuevoEstado = "en_proceso";

  if (nuevoEstado !== estadoActual) {
    await client.query(
      "UPDATE purchase_orders SET estado = $1 WHERE id = $2",
      [nuevoEstado, po_id],
    );
  }
}

/**
 * Regla de negocio: un QR no puede pertenecer a más de una PO.
 * Lanza error si alguno de los QRs indicados ya está vinculado a una PO
 * distinta de `poEsperada`, por cualquiera de los dos caminos posibles:
 *   - escaneos.caja_id   -> cajas.carton_id   -> cartones.po_id
 *   - escaneos.carton_id -> cartones.po_id
 * Una vez que un QR queda ligado a una PO, no puede asignarse a otra.
 */
async function assertQRsNoEnOtraPO(client, qrIds, poEsperada) {
  if (!qrIds.length) return;
  const { rows } = await client.query(
    `SELECT DISTINCT q.codigo_qr, po.po_number
       FROM escaneos e
       JOIN cajas ca           ON ca.id = e.caja_id
       JOIN cartones c         ON c.id = ca.carton_id
       JOIN codigos_qr q       ON q.id = e.codigo_qr_id
       JOIN purchase_orders po ON po.id = c.po_id
      WHERE e.codigo_qr_id = ANY($1) AND c.po_id <> $2
      UNION
      SELECT DISTINCT q.codigo_qr, po.po_number
       FROM escaneos e
       JOIN cartones c         ON c.id = e.carton_id
       JOIN codigos_qr q       ON q.id = e.codigo_qr_id
       JOIN purchase_orders po ON po.id = c.po_id
      WHERE e.codigo_qr_id = ANY($1) AND c.po_id <> $2`,
    [qrIds, poEsperada],
  );
  if (rows.length) {
    const detalle = rows
      .map((r) => `${r.codigo_qr} → PO ${r.po_number}`)
      .join(", ");
    throw {
      status: 409,
      message: `No se puede asignar: ${rows.length} QR(s) ya pertenecen a otra PO y no pueden moverse: ${detalle}`,
    };
  }
}

// Pares por cama dentro de una caja de 12.
const CAMA = 6;

async function asignarCajaACarton(caja_id, carton_id, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Caja y cartón bloqueados: dos estaciones no pueden tomar los mismos
    // pares ni llenar dos veces el mismo cartón.
    const { rows: cajaRows } = await client.query(
      "SELECT * FROM cajas WHERE id = $1 FOR UPDATE",
      [caja_id],
    );
    const caja = cajaRows[0];
    if (!caja) throw { status: 404, message: "Caja no encontrada" };
    if (caja.estado !== "empacada")
      throw { status: 409, message: "La caja debe estar empacada" };

    const { rows: cartonRows } = await client.query(
      "SELECT * FROM cartones WHERE id = $1 FOR UPDATE",
      [carton_id],
    );
    const carton = cartonRows[0];
    if (!carton) throw { status: 404, message: "Cartón no encontrado" };
    if (carton.tipo !== "mono_sku")
      throw {
        status: 400,
        message: "Este endpoint solo es para cartones mono_sku",
      };
    if (carton.estado === "completo")
      throw { status: 409, message: "El cartón ya está completo" };

    const { rows: detalleRows } = await client.query(
      "SELECT sku_id, cantidad_por_carton FROM carton_detalles WHERE carton_id = $1",
      [carton_id],
    );
    if (detalleRows[0].sku_id !== caja.sku_id) {
      throw {
        status: 400,
        message: "El SKU de la caja no coincide con el SKU del cartón",
      };
    }

    const cartonEsperado = detalleRows[0].cantidad_por_carton;

    // Cartones de menos de 12 pares. Solo el de 6 acepta caja: una caja de 12
    // trae dos camas de 6, y cada escaneo de la caja aporta una cama (la de
    // arriba primero: los últimos 6 pares escaneados en Producción). El resto
    // de cantidades (3, 4, 7, 8…) se llenan QR por QR.
    if (cartonEsperado < 12) {
      if (cartonEsperado !== CAMA)
        throw {
          status: 400,
          message: `Los cartones de ${cartonEsperado} pares se llenan QR por QR`,
        };
      if (caja.carton_id)
        throw {
          status: 409,
          message: "La caja ya fue asignada completa a otro cartón",
        };

      const { rows: enCarton } = await client.query(
        "SELECT COUNT(*)::int AS n FROM escaneos WHERE carton_id = $1",
        [carton_id],
      );
      if (enCarton[0].n > 0)
        throw {
          status: 409,
          message: "Este cartón ya tiene pares sueltos: complétalo con QR",
        };

      const { rows: disponibles } = await client.query(
        `SELECT e.codigo_qr_id
           FROM escaneos e
          WHERE e.caja_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM escaneos e2
               WHERE e2.codigo_qr_id = e.codigo_qr_id
                 AND e2.carton_id IS NOT NULL
            )
          ORDER BY e.created_at DESC`,
        [caja_id],
      );
      if (!disponibles.length)
        throw {
          status: 409,
          message: "La caja ya no tiene pares disponibles: todos están en otros cartones",
        };
      // Si de la caja ya salieron pares sueltos, sus camas no están completas.
      if (disponibles.length % CAMA !== 0)
        throw {
          status: 409,
          message: `A la caja le quedan ${disponibles.length} pares, no camas completas de ${CAMA}: escanea los QR uno por uno`,
        };

      const cama = disponibles.slice(0, CAMA);
      await assertQRsNoEnOtraPO(
        client,
        cama.map((d) => d.codigo_qr_id),
        carton.po_id,
      );
      for (const d of cama) {
        await client.query(
          "INSERT INTO escaneos (carton_id, codigo_qr_id, created_by) VALUES ($1, $2, $3)",
          [carton_id, d.codigo_qr_id, user_id || caja.created_by],
        );
      }
      await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
        "completo",
        carton_id,
      ]);
      await actualizarEstadoPO(client, carton_id);

      await client.query("COMMIT");
      return {
        message: `Cartón completado con una cama de ${CAMA} pares`,
        carton_id,
        caja_id,
        modo: "cama",
        pares_asignados: CAMA,
        pares_restantes: disponibles.length - CAMA,
      };
    }

    // Caso 1:1 — caja y cartón con la misma cantidad de pares
    if (caja.cantidad_pares === cartonEsperado) {
      if (caja.carton_id)
        throw { status: 409, message: "La caja ya está asignada a un cartón" };

      // Ningún QR de la caja puede estar ya ligado a otra PO (ej. reasociado a un musical)
      const { rows: qrsCaja } = await client.query(
        "SELECT codigo_qr_id FROM escaneos WHERE caja_id = $1",
        [caja_id],
      );
      await assertQRsNoEnOtraPO(
        client,
        qrsCaja.map((r) => r.codigo_qr_id),
        carton.po_id,
      );

      await client.query("UPDATE cajas SET carton_id = $1 WHERE id = $2", [
        carton_id,
        caja_id,
      ]);
      await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
        "completo",
        carton_id,
      ]);

      await actualizarEstadoPO(client, carton_id);
      await client.query("COMMIT");
      return {
        message: "Caja asignada al cartón correctamente",
        carton_id,
        caja_id,
        modo: "directo",
      };
    }

    // Caso split — caja con más pares que el cartón (ej. caja 24 → cartón 12)
    if (
      caja.cantidad_pares > cartonEsperado &&
      caja.cantidad_pares % cartonEsperado === 0
    ) {
      if (caja.carton_id)
        throw {
          status: 409,
          message:
            "La caja ya fue asignada directamente a un cartón y no puede dividirse",
        };

      // QRs de la caja aún no consumidos por ningún cartón (LIFO: últimos escaneados primero)
      const { rows: disponibles } = await client.query(
        `SELECT e.codigo_qr_id, e.created_at
         FROM escaneos e
         WHERE e.caja_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM escaneos e2
             WHERE e2.codigo_qr_id = e.codigo_qr_id
               AND e2.carton_id IS NOT NULL
           )
         ORDER BY e.created_at DESC
         LIMIT $2`,
        [caja_id, cartonEsperado],
      );

      if (disponibles.length < cartonEsperado) {
        throw {
          status: 409,
          message: `La caja no tiene suficientes pares disponibles para este cartón (disponibles: ${disponibles.length}, requeridos: ${cartonEsperado})`,
        };
      }

      await assertQRsNoEnOtraPO(
        client,
        disponibles.map((d) => d.codigo_qr_id),
        carton.po_id,
      );

      // Insertar un escaneo por QR vinculado al cartón (sin caja_id, igual que reasociaciones)
      for (const d of disponibles) {
        await client.query(
          "INSERT INTO escaneos (carton_id, codigo_qr_id, created_by) VALUES ($1, $2, $3)",
          [carton_id, d.codigo_qr_id, caja.created_by],
        );
      }

      await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
        "completo",
        carton_id,
      ]);

      // Pares de la caja que aún no ha consumido ningún cartón. Sirve para
      // avisar al operador que la misma caja alcanza para otro cartón.
      const { rows: restantesRows } = await client.query(
        `SELECT COUNT(*)::int AS restantes
           FROM escaneos e
          WHERE e.caja_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM escaneos e2
              WHERE e2.codigo_qr_id = e.codigo_qr_id
                AND e2.carton_id IS NOT NULL
            )`,
        [caja_id],
      );
      const paresRestantes = restantesRows[0].restantes;

      await actualizarEstadoPO(client, carton_id);
      await client.query("COMMIT");
      return {
        message: `Cartón completado con ${cartonEsperado} pares de la caja`,
        carton_id,
        caja_id,
        modo: "split",
        pares_asignados: cartonEsperado,
        pares_restantes: paresRestantes,
      };
    }

    throw {
      status: 400,
      message: `La caja (${caja.cantidad_pares}) no es compatible con el cartón (${cartonEsperado}). Solo se soportan 1:1 o múltiplos exactos (ej. caja 24 → cartón 12).`,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function reasociarQRaMusical(carton_id, codigo_qr, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validar cartón
    const { rows: cartonRows } = await client.query(
      `SELECT c.*, 
        json_agg(json_build_object(
          'sku_id', cd.sku_id,
          'sku_number', s.sku_number,
          'cantidad_por_carton', cd.cantidad_por_carton
        )) AS detalles
       FROM cartones c
       JOIN carton_detalles cd ON cd.carton_id = c.id
       JOIN skus s ON s.id = cd.sku_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [carton_id],
    );
    const carton = cartonRows[0];
    if (!carton) throw { status: 404, message: "Cartón no encontrado" };
    if (carton.estado === "completo")
      throw { status: 409, message: "El cartón ya está completo" };

    const totalEsperado = carton.detalles.reduce(
      (sum, d) => sum + d.cantidad_por_carton,
      0,
    );
    const esParcial = carton.tipo === "mono_sku" && totalEsperado < 12;
    if (carton.tipo !== "musical" && !esParcial)
      throw {
        status: 400,
        message:
          "Este endpoint es para cartones musicales o mono_sku parciales (<12 pares)",
      };

    // Validar QR
    const { rows: qrRows } = await client.query(
      `SELECT qr.*, s.sku_number 
       FROM codigos_qr qr
       JOIN skus s ON s.id = qr.sku_id
       WHERE qr.codigo_qr = $1`,
      [normalizeQR(codigo_qr)],
    );
    const qr = qrRows[0];
    if (!qr) throw { status: 404, message: "QR no encontrado" };
    if (qr.estado !== "escaneado")
      throw {
        status: 409,
        message: `El QR debe estar en estado escaneado, está: ${qr.estado}`,
      };

    // Validar que el SKU del QR pertenece a este cartón
    const detalle = carton.detalles.find((d) => d.sku_id === qr.sku_id);
    if (!detalle)
      throw {
        status: 400,
        message: `El SKU ${qr.sku_number} no pertenece a este cartón`,
      };

    // Validar que el QR no fue ya reasociado a ningún cartón
    const { rows: yaEnCarton } = await client.query(
      "SELECT id FROM escaneos WHERE codigo_qr_id = $1 AND carton_id IS NOT NULL",
      [qr.id],
    );
    if (yaEnCarton[0])
      throw { status: 409, message: "Este QR ya fue reasociado a un cartón" };

    // Validar que la caja del QR no esté asignada a un cartón mono
    const { rows: cajaDelQR } = await client.query(
      `SELECT c.carton_id FROM escaneos e
       JOIN cajas c ON c.id = e.caja_id
       WHERE e.codigo_qr_id = $1 AND e.caja_id IS NOT NULL`,
      [qr.id],
    );
    if (cajaDelQR[0]?.carton_id)
      throw { status: 409, message: "Este QR pertenece a una caja ya asignada a otro cartón" };

    // Contar cuántos QRs de este SKU ya están en el cartón musical
    const { rows: conteo } = await client.query(
      `SELECT COUNT(*) AS total
       FROM escaneos e
       JOIN codigos_qr q ON q.id = e.codigo_qr_id
       WHERE e.carton_id = $1 AND q.sku_id = $2`,
      [carton_id, qr.sku_id],
    );
    const yaReasociados = parseInt(conteo[0].total);
    if (yaReasociados >= detalle.cantidad_por_carton) {
      throw {
        status: 409,
        message: `Ya se completaron los ${detalle.cantidad_por_carton} pares de SKU ${detalle.sku_number} en este cartón`,
      };
    }

    // Insertar escaneo de reasociación (carton_id, sin caja_id)
    await client.query(
      "INSERT INTO escaneos (carton_id, codigo_qr_id, created_by) VALUES ($1, $2, $3)",
      [carton_id, qr.id, user_id],
    );

    // Verificar si el cartón está completo
    const { rows: totalRows } = await client.query(
      "SELECT COUNT(*) AS total FROM escaneos WHERE carton_id = $1",
      [carton_id],
    );
    const totalReasociados = parseInt(totalRows[0].total);

    if (totalReasociados >= totalEsperado) {
      await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
        "completo",
        carton_id,
      ]);
      await actualizarEstadoPO(client, carton_id);
    }

    await client.query("COMMIT");

    return {
      qr: qr.codigo_qr,
      sku: qr.sku_number,
      reasociados: totalReasociados,
      total: totalEsperado,
      completo: totalReasociados >= totalEsperado,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getCarton(carton_id) {
  const { rows } = await pool.query(
    `SELECT c.*, po.po_number,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN purchase_orders po ON po.id = c.po_id
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.id = $1
     GROUP BY c.id, po.po_number`,
    [carton_id],
  );
  if (!rows[0]) throw { status: 404, message: "Cartón no encontrado" };
  return rows[0];
}

async function getCartonesPorPO(po_id) {
  const { rows } = await pool.query(
    `SELECT c.*,
      json_agg(DISTINCT jsonb_build_object(
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.po_id = $1
     GROUP BY c.id
     ORDER BY c.carton_id`,
    [po_id],
  );
  return rows;
}

async function getProgresoMusical(carton_id) {
  const { rows: cartonRows } = await pool.query(
    `SELECT c.*,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.id = $1
     GROUP BY c.id`,
    [carton_id],
  );
  if (!cartonRows[0]) throw { status: 404, message: "Cartón no encontrado" };
  const carton = cartonRows[0];

  const { rows: porSku } = await pool.query(
    `SELECT s.sku_number, s.id AS sku_id, COUNT(e.id) AS reasociados
     FROM escaneos e
     JOIN codigos_qr q ON q.id = e.codigo_qr_id
     JOIN skus s ON s.id = q.sku_id
     WHERE e.carton_id = $1
     GROUP BY s.id`,
    [carton_id],
  );

  return { carton, progreso_por_sku: porSku };
}

async function buscarCarton(codigo) {
  const codigoNormalizado = codigo.replace(/'/g, "-");
  const { rows } = await pool.query(
    `SELECT c.*, po.po_number,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN purchase_orders po ON po.id = c.po_id
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.carton_id = $1
     GROUP BY c.id, po.po_number`,
    [codigoNormalizado],
  );
  if (!rows[0]) throw { status: 404, message: "Cartón no encontrado" };
  return rows[0];
}

async function getResumenPO(po_id) {
  const { rows: poRows } = await pool.query(
    `SELECT id, po_number, estado,
            to_char(cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date,
            cantidad_pares, cantidad_cartones
     FROM purchase_orders WHERE id = $1`,
    [po_id],
  );
  if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };

  const { rows: cartones } = await pool.query(
    `SELECT
       c.id, c.carton_id, c.tipo, c.estado,
       (SELECT SUM(cd.cantidad_por_carton) FROM carton_detalles cd WHERE cd.carton_id = c.id) AS pares_esperados,
       -- Dos conteos en vez de un OR entre tablas, para que usen los índices.
       -- Un escaneo trae caja_id (Producción) o carton_id (Embarque), nunca ambos.
       (
         SELECT COUNT(*) FROM escaneos e
         JOIN cajas ca ON ca.id = e.caja_id
         WHERE ca.carton_id = c.id
       ) + (
         SELECT COUNT(*) FROM escaneos e WHERE e.carton_id = c.id
       ) AS pares_escaneados
     FROM cartones c
     WHERE c.po_id = $1
     ORDER BY c.carton_id`,
    [po_id],
  );

  const total = cartones.length;
  const completos = cartones.filter((c) => c.estado === "completo").length;
  const pendientes = cartones.filter((c) => c.estado !== "completo");

  const enProceso = pendientes.filter(
    (c) => parseInt(c.pares_escaneados) > 0,
  );
  const sinIniciar = pendientes.filter(
    (c) => parseInt(c.pares_escaneados) === 0,
  );

  return {
    po: poRows[0],
    total_cartones: total,
    completos,
    pendientes: pendientes.length,
    cartones_en_proceso: enProceso,
    cartones_sin_iniciar: sinIniciar,
  };
}

// --- Musicales por PO (SOP de musicales) ---
// El operador escribe la PO y escanea las cajas de Producción: sus QRs quedan
// en la PO y el sistema los reparte a los cartones musicales por SKU. A T4 se
// le manda la PO con sus QRs por SKU, sin cartón, así que no importa en qué
// cartón físico quedó cada par (Crocs lo aceptó). Si la caja trae más pares
// de los que le faltan a la PO, se separan y se escanean QR por QR.

async function resumenMusical(db, po_id) {
  const { rows: poRows } = await db.query(
    `SELECT id, po_number, estado, to_char(cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date
       FROM purchase_orders WHERE id = $1`,
    [po_id],
  );
  const { rows: cartones } = await db.query(
    `SELECT COUNT(*)::int AS total,
            (COUNT(*) FILTER (WHERE estado = 'completo'))::int AS completos
       FROM cartones WHERE po_id = $1 AND tipo = 'musical'`,
    [po_id],
  );
  const { rows: skus } = await db.query(
    `WITH mus AS (SELECT id FROM cartones WHERE po_id = $1 AND tipo = 'musical'),
     ped AS (
       SELECT cd.sku_id, SUM(cd.cantidad_por_carton)::int AS pedidos
         FROM carton_detalles cd JOIN mus ON mus.id = cd.carton_id
        GROUP BY cd.sku_id
     ),
     asi AS (
       SELECT q.sku_id, COUNT(*)::int AS asignados
         FROM escaneos e
         JOIN mus ON mus.id = e.carton_id
         JOIN codigos_qr q ON q.id = e.codigo_qr_id
        GROUP BY q.sku_id
     )
     SELECT s.id AS sku_id, s.sku_number, s.size, s.style_name,
            ped.pedidos, COALESCE(asi.asignados, 0) AS asignados
       FROM ped
       JOIN skus s ON s.id = ped.sku_id
       LEFT JOIN asi ON asi.sku_id = ped.sku_id
      ORDER BY s.sku_number`,
    [po_id],
  );
  return {
    po: poRows[0],
    cartones_total: cartones[0].total,
    cartones_completos: cartones[0].completos,
    pedidos: skus.reduce((a, s) => a + s.pedidos, 0),
    asignados: skus.reduce((a, s) => a + s.asignados, 0),
    skus,
  };
}

function validarPOMusical(po) {
  if (po.estado === "enviado")
    throw { status: 409, message: `La PO ${po.po_number} ya se envió a T4` };
  if (po.estado === "cancelado")
    throw { status: 409, message: `La PO ${po.po_number} está cancelada` };
}

async function buscarPOMusical(po_number) {
  const numero = String(po_number || "").trim();
  if (!numero) throw { status: 400, message: "Escribe el número de PO" };
  const { rows } = await pool.query(
    "SELECT id, po_number, estado FROM purchase_orders WHERE po_number = $1",
    [numero],
  );
  if (!rows[0]) throw { status: 404, message: `No existe la PO ${numero}` };
  validarPOMusical(rows[0]);
  const resumen = await resumenMusical(pool, rows[0].id);
  if (!resumen.cartones_total)
    throw { status: 400, message: `La PO ${numero} no tiene cartones musicales` };
  return resumen;
}

async function getResumenMusical(po_id) {
  const resumen = await resumenMusical(pool, po_id);
  if (!resumen.po) throw { status: 404, message: "PO no encontrada" };
  return resumen;
}

// Bloquea la PO: dos estaciones con la misma PO no reparten a la vez.
async function bloquearPOMusical(client, po_id) {
  const { rows } = await client.query(
    "SELECT id, po_number, estado FROM purchase_orders WHERE id = $1 FOR UPDATE",
    [po_id],
  );
  if (!rows[0]) throw { status: 404, message: "PO no encontrada" };
  validarPOMusical(rows[0]);
  return rows[0];
}

// Cuántos pares de un SKU pide la PO en sus musicales y cuántos lleva.
async function avanceSkuMusical(client, po_id, sku_id) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(cd.cantidad_por_carton), 0)
          FROM carton_detalles cd JOIN cartones c ON c.id = cd.carton_id
         WHERE c.po_id = $1 AND c.tipo = 'musical' AND cd.sku_id = $2)::int AS pedidos,
       (SELECT COUNT(*)
          FROM escaneos e
          JOIN cartones c ON c.id = e.carton_id
          JOIN codigos_qr q ON q.id = e.codigo_qr_id
         WHERE c.po_id = $1 AND c.tipo = 'musical' AND q.sku_id = $2)::int AS asignados`,
    [po_id, sku_id],
  );
  return { ...rows[0], faltan: rows[0].pedidos - rows[0].asignados };
}

// Reparte los QRs (todos del mismo SKU) entre los cartones musicales de la PO
// que aún tienen lugar para ese SKU, en orden de cartón.
async function repartirEnMusicales(client, po_id, sku_id, qrIds, user_id) {
  const { rows: huecos } = await client.query(
    `SELECT c.id,
            cd.cantidad_por_carton - (
              SELECT COUNT(*) FROM escaneos e
                JOIN codigos_qr q ON q.id = e.codigo_qr_id
               WHERE e.carton_id = c.id AND q.sku_id = $2)::int AS hueco
       FROM cartones c
       JOIN carton_detalles cd ON cd.carton_id = c.id AND cd.sku_id = $2
      WHERE c.po_id = $1 AND c.tipo = 'musical' AND c.estado <> 'completo'
      ORDER BY c.carton_id
        FOR UPDATE OF c`,
    [po_id, sku_id],
  );

  const pendientes = [...qrIds];
  const tocados = [];
  for (const { id, hueco } of huecos) {
    if (!pendientes.length) break;
    if (hueco <= 0) continue;
    const lote = pendientes.splice(0, hueco);
    await client.query(
      `INSERT INTO escaneos (carton_id, codigo_qr_id, created_by)
       SELECT $1, unnest($2::int[]), $3`,
      [id, lote, user_id],
    );
    tocados.push(id);
  }
  if (pendientes.length)
    throw {
      status: 409,
      message: "Los cartones musicales de la PO ya no tienen lugar para este SKU",
    };

  const { rows: completados } = await client.query(
    `UPDATE cartones c SET estado = 'completo'
      WHERE c.id = ANY($1)
        AND (SELECT COUNT(*) FROM escaneos e WHERE e.carton_id = c.id)
            >= (SELECT SUM(cd.cantidad_por_carton) FROM carton_detalles cd WHERE cd.carton_id = c.id)
      RETURNING c.id`,
    [tocados],
  );
  await actualizarEstadoPO(client, tocados[0]);
  return completados.length;
}

async function asignarCajaAPOMusical(po_id, codigo_caja, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const po = await bloquearPOMusical(client, po_id);

    const { rows: cajaRows } = await client.query(
      `SELECT ca.*, s.sku_number
         FROM cajas ca JOIN skus s ON s.id = ca.sku_id
        WHERE ca.codigo_caja = $1
          FOR UPDATE OF ca`,
      [normalizeCodigoCaja(codigo_caja)],
    );
    const caja = cajaRows[0];
    if (!caja) throw { status: 404, message: "Caja no encontrada" };
    if (caja.estado !== "empacada")
      throw { status: 409, message: "La caja sigue abierta: ciérrala en Producción" };
    if (caja.carton_id)
      throw { status: 409, message: "La caja ya está completa en un cartón mono SKU" };

    const avance = await avanceSkuMusical(client, po_id, caja.sku_id);
    if (!avance.pedidos)
      throw {
        status: 400,
        message: `La PO ${po.po_number} no lleva ${caja.sku_number} en sus musicales`,
      };
    if (avance.faltan <= 0)
      throw {
        status: 409,
        message: `La PO ya tiene sus ${avance.pedidos} pares de ${caja.sku_number}`,
      };

    // Pares de la caja que no están en ningún cartón.
    const { rows: disponibles } = await client.query(
      `SELECT e.codigo_qr_id
         FROM escaneos e
        WHERE e.caja_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM escaneos e2
             WHERE e2.codigo_qr_id = e.codigo_qr_id AND e2.carton_id IS NOT NULL)
        ORDER BY e.created_at DESC`,
      [caja.id],
    );
    if (!disponibles.length)
      throw {
        status: 409,
        message: "La caja ya no tiene pares disponibles: todos están en cartones",
      };

    // La caja trae más de lo que falta: se separan los pares y van QR por QR.
    if (disponibles.length > avance.faltan) {
      await client.query("ROLLBACK");
      return {
        requiere_qr: true,
        sku_number: caja.sku_number,
        faltan: avance.faltan,
        disponibles: disponibles.length,
        resumen: await resumenMusical(pool, po_id),
      };
    }

    const qrIds = disponibles.map((d) => d.codigo_qr_id);
    await assertQRsNoEnOtraPO(client, qrIds, po_id);
    const completados = await repartirEnMusicales(client, po_id, caja.sku_id, qrIds, user_id);
    const resumen = await resumenMusical(client, po_id);
    await client.query("COMMIT");
    return {
      asignados: qrIds.length,
      sku_number: caja.sku_number,
      cartones_completados: completados,
      resumen,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function asignarQRAPOMusical(po_id, codigo_qr, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const po = await bloquearPOMusical(client, po_id);

    const { rows: qrRows } = await client.query(
      `SELECT q.*, s.sku_number
         FROM codigos_qr q LEFT JOIN skus s ON s.id = q.sku_id
        WHERE q.codigo_qr = $1`,
      [normalizeQR(String(codigo_qr).trim())],
    );
    const qr = qrRows[0];
    if (!qr) throw { status: 404, message: "QR no encontrado" };
    if (!qr.sku_id)
      throw { status: 400, message: "El QR no tiene SKU: su UPC no está en el catálogo" };
    if (qr.estado === "disponible")
      throw { status: 409, message: "Este par no se escaneó en Producción" };
    if (qr.estado === "enviado")
      throw { status: 409, message: "Este QR ya se envió a T4" };

    // La caja del par: bloqueada, para no competir con quien escanee la caja.
    const { rows: cajaRows } = await client.query(
      `SELECT ca.* FROM cajas ca
        WHERE ca.id = (SELECT e.caja_id FROM escaneos e
                        WHERE e.codigo_qr_id = $1 AND e.caja_id IS NOT NULL
                        ORDER BY e.id LIMIT 1)
          FOR UPDATE`,
      [qr.id],
    );
    const caja = cajaRows[0];
    if (!caja) throw { status: 409, message: "Este par no está en ninguna caja de Producción" };
    if (caja.estado !== "empacada")
      throw { status: 409, message: "La caja de este par sigue abierta en Producción" };
    if (caja.carton_id)
      throw { status: 409, message: "Este par está en una caja completa en un cartón mono SKU" };

    const { rows: yaEn } = await client.query(
      `SELECT po.id, po.po_number FROM escaneos e
         JOIN cartones c ON c.id = e.carton_id
         JOIN purchase_orders po ON po.id = c.po_id
        WHERE e.codigo_qr_id = $1
        LIMIT 1`,
      [qr.id],
    );
    if (yaEn[0])
      throw {
        status: 409,
        message:
          yaEn[0].id === po.id
            ? "Este par ya está en esta PO"
            : `Este par ya está en la PO ${yaEn[0].po_number}`,
      };

    const avance = await avanceSkuMusical(client, po_id, qr.sku_id);
    if (!avance.pedidos)
      throw {
        status: 400,
        message: `La PO ${po.po_number} no lleva ${qr.sku_number} en sus musicales`,
      };
    if (avance.faltan <= 0)
      throw {
        status: 409,
        message: `La PO ya tiene sus ${avance.pedidos} pares de ${qr.sku_number}`,
      };

    const completados = await repartirEnMusicales(client, po_id, qr.sku_id, [qr.id], user_id);
    const resumen = await resumenMusical(client, po_id);
    await client.query("COMMIT");
    return {
      asignados: 1,
      sku_number: qr.sku_number,
      faltan_sku: avance.faltan - 1,
      cartones_completados: completados,
      resumen,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  asignarCajaACarton,
  reasociarQRaMusical,
  getCarton,
  getCartonesPorPO,
  getProgresoMusical,
  buscarCarton,
  actualizarEstadoPO,
  getResumenPO,
  buscarPOMusical,
  getResumenMusical,
  asignarCajaAPOMusical,
  asignarQRAPOMusical,
};
