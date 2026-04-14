const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ error: "Token requerido" });

  const token = auth.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
};
