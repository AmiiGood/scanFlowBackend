const jwt = require("jsonwebtoken");
const permisosService = require("../services/permisosService");

// Valida el token y carga los permisos vigentes del usuario (su perfil). Así
// un cambio de perfil o una baja aplican sin esperar a que venza el token.
module.exports = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ error: "Token requerido" });

  let payload;
  try {
    payload = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  try {
    const info = await permisosService.deUsuario(payload.id);
    if (!info || !info.activo)
      return res.status(401).json({ error: "Usuario desactivado" });
    req.user = { ...payload, rol: info.rol, perfil: info.perfil, permisos: info.permisos };
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
