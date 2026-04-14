const pool = require("../config/database");
const bcrypt = require("bcrypt");

const SEED_USERS = [
  {
    nombre: "Super Admin",
    email: "admin@foamcreations.mx",
    rol: "superadmin",
  },
  {
    nombre: "Operador Producción",
    email: "produccion@foamcreations.mx",
    rol: "operador_produccion",
  },
  {
    nombre: "Operador Embarque",
    email: "embarque@foamcreations.mx",
    rol: "operador_embarque",
  },
];

const PASSWORD = "*FCMX2026";
const SALT_ROUNDS = 12;

// Tablas en orden de inserción (respeta FK)
const TABLES_ORDERED = [
  "users",
  "skus",
  "purchase_orders",
  "cartones",
  "carton_detalles",
  "codigos_qr",
  "cajas",
  "escaneos",
  "envios_trysor",
  "refresh_tokens",
];

async function generate(req, res) {
  const { includeData = true } = req.body;

  try {
    const client = await pool.connect();
    const lines = [];

    lines.push("-- ScanFlow Backup");
    lines.push(`-- Generado: ${new Date().toISOString()}`);
    lines.push(`-- Tipo: ${includeData ? "Completo (estructura + datos)" : "Solo estructura"}`);
    lines.push("");

    // ── ESTRUCTURA ──────────────────────────────────────────────────────
    lines.push("-- =====================================================");
    lines.push("-- ESTRUCTURA");
    lines.push("-- =====================================================");
    lines.push("");

    // DROP en orden inverso para evitar errores de FK
    const dropOrder = [...TABLES_ORDERED].reverse();
    for (const table of dropOrder) {
      lines.push(`DROP TABLE IF EXISTS ${table} CASCADE;`);
    }
    lines.push("");

    // Obtener DDL de cada tabla
    for (const table of TABLES_ORDERED) {
      const { rows: cols } = await client.query(
        `SELECT column_name, data_type, character_maximum_length,
                is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = 'public'
         ORDER BY ordinal_position`,
        [table],
      );

      if (!cols.length) continue;

      // Constraints
      const { rows: constraints } = await client.query(
        `SELECT tc.constraint_type, tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column,
                rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         LEFT JOIN information_schema.referential_constraints rc
           ON tc.constraint_name = rc.constraint_name
          AND tc.table_schema = rc.constraint_schema
         LEFT JOIN information_schema.constraint_column_usage ccu
           ON rc.unique_constraint_name = ccu.constraint_name
         WHERE tc.table_name = $1 AND tc.table_schema = 'public'`,
        [table],
      );

      const { rows: checks } = await client.query(
        `SELECT cc.constraint_name, cc.check_clause
         FROM information_schema.check_constraints cc
         JOIN information_schema.table_constraints tc
           ON cc.constraint_name = tc.constraint_name
         WHERE tc.table_name = $1 AND tc.table_schema = 'public'`,
        [table],
      );

      const colDefs = cols.map((c) => {
        let type = c.data_type.toUpperCase();
        if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
        if (c.column_default?.includes("nextval")) type = "SERIAL";

        let def = `  ${c.column_name} ${type}`;
        if (c.column_default && !c.column_default.includes("nextval")) {
          def += ` DEFAULT ${c.column_default}`;
        }
        if (c.is_nullable === "NO" && !c.column_default?.includes("nextval")) {
          def += " NOT NULL";
        }
        return def;
      });

      // PK
      const pk = constraints.find((c) => c.constraint_type === "PRIMARY KEY");
      if (pk) colDefs.push(`  PRIMARY KEY (${pk.column_name})`);

      // FK
      const fks = constraints.filter((c) => c.constraint_type === "FOREIGN KEY");
      for (const fk of fks) {
        let fkDef = `  FOREIGN KEY (${fk.column_name}) REFERENCES ${fk.foreign_table}(${fk.foreign_column})`;
        if (fk.delete_rule && fk.delete_rule !== "NO ACTION") {
          fkDef += ` ON DELETE ${fk.delete_rule}`;
        }
        colDefs.push(fkDef);
      }

      // UNIQUE
      const uniques = constraints.filter((c) => c.constraint_type === "UNIQUE");
      for (const u of uniques) {
        colDefs.push(`  UNIQUE (${u.column_name})`);
      }

      // CHECK
      for (const chk of checks) {
        if (!chk.check_clause.includes("IS NOT NULL")) {
          colDefs.push(`  CHECK (${chk.check_clause})`);
        }
      }

      lines.push(`CREATE TABLE ${table} (`);
      lines.push(colDefs.join(",\n"));
      lines.push(");");
      lines.push("");
    }

    // ── DATOS ────────────────────────────────────────────────────────────
    if (includeData) {
      lines.push("-- =====================================================");
      lines.push("-- DATOS");
      lines.push("-- =====================================================");
      lines.push("");

      for (const table of TABLES_ORDERED) {
        // Saltar refresh_tokens — tokens expirados no valen
        if (table === "refresh_tokens") continue;

        const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY id`);
        if (!rows.length) continue;

        lines.push(`-- ${table}`);

        for (const row of rows) {
          const cols = Object.keys(row).join(", ");
          const vals = Object.values(row).map((v) => {
            if (v === null) return "NULL";
            if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
            if (typeof v === "number") return v;
            if (v instanceof Date) return `'${v.toISOString()}'`;
            if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          lines.push(`INSERT INTO ${table} (${cols}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`);
        }

        // Resetear sequences
        lines.push(`SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id) FROM ${table}), 1));`);
        lines.push("");
      }
    }

    // ── USUARIOS SEED ────────────────────────────────────────────────────
    lines.push("-- =====================================================");
    lines.push("-- USUARIOS GARANTIZADOS (uno por rol)");
    lines.push("-- =====================================================");
    lines.push("");

    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    for (const u of SEED_USERS) {
      lines.push(
        `INSERT INTO users (nombre, email, password_hash, rol, activo)` +
        ` VALUES ('${u.nombre}', '${u.email}', '${passwordHash}', '${u.rol}', TRUE)` +
        ` ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, activo = TRUE;`,
      );
    }

    lines.push("");
    lines.push("-- Fin del backup");

    client.release();

    const sql = lines.join("\n");
    const filename = `scanflow_backup_${includeData ? "full" : "schema"}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.sql`;

    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(sql);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { generate };
