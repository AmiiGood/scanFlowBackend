const authService = require("../services/authService");

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email y password requeridos" });

    const { accessToken, refreshToken, user } = await authService.login(
      email,
      password,
    );
    res.cookie("refreshToken", refreshToken, COOKIE_OPTS);
    res.json({ accessToken, user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function refresh(req, res) {
  try {
    const refreshToken = req.cookies.refreshToken;
    const { accessToken } = await authService.refresh(refreshToken);
    res.json({ accessToken });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function logout(req, res) {
  try {
    const refreshToken = req.cookies.refreshToken;
    await authService.logout(refreshToken);
    res.clearCookie("refreshToken");
    res.json({ message: "Sesión cerrada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { login, refresh, logout };
