const { callApi } = require("./trysorService");

async function enviarPO(po_number, cartones) {
  const url = process.env.T4_API_URL;
  const appKey = process.env.T4_APP_KEY;
  const appSecret = process.env.T4_APP_SECRET;
  const method = "genpoassociation";

  const businessData = {
    poNumber: po_number,
    cartons: cartones.map((c) => ({
      cartonId: c.carton_id,
      skuList: c.detalles.map((d) => ({
        sku: d.sku_number,
        quantity: d.cantidad_por_carton,
      })),
    })),
  };

  return callApi(url, method, appKey, appSecret, businessData);
}

async function cancelarPO(po_number) {
  const url = process.env.T4_API_URL;
  const appKey = process.env.T4_APP_KEY;
  const appSecret = process.env.T4_APP_SECRET;
  const method = "cancelpoassociation";

  return callApi(url, method, appKey, appSecret, { poNumber: po_number });
}

module.exports = { enviarPO, cancelarPO };
