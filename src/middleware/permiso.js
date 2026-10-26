// Exige al menos uno de los permisos indicados. Los permisos los carga
// `authenticate` desde el perfil del usuario.
module.exports =
  (...permisos) =>
  (req, res, next) => {
    if (!permisos.some((p) => req.user.permisos?.has(p)))
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    next();
  };
