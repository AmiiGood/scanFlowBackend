require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/skus", require("./routes/skuRoutes"));
app.use("/api/purchase-orders", require("./routes/poRoutes"));
app.use("/api/qr", require("./routes/qrRoutes"));
app.use("/api/cajas", require("./routes/cajaRoutes"));
app.use("/api/embarque", require("./routes/embarqueRoutes"));
app.use("/api/trysor", require("./routes/trysorRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/backup", require("./routes/backupRoutes"));
app.use("/api/reset", require("./routes/resetRoutes"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Error interno" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
