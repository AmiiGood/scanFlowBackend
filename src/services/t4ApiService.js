const { callApi } = require("./trysorService");

const T4_CONSTANTS = {
  Brand: "Crocs",
  ShipToId: "2026",
  FacilitySite: "0000100315",
  ProductCategory: "Footwear",
  Gender: "Unisex",
};

async function enviarPO(po, skusConCodigos) {
  const url = process.env.T4_API_URL;
  const appKey = process.env.T4_APP_KEY;
  const appSecret = process.env.T4_APP_SECRET;
  const method = "genpoassociation";

  const businessData = skusConCodigos.map((sku) => ({
    PoNo: po.po_number,
    Brand: T4_CONSTANTS.Brand,
    ShipToId: T4_CONSTANTS.ShipToId,
    StyleNo: sku.style_no,
    StyleName: sku.style_name,
    Color: sku.color,
    SkuNumber: sku.sku_number,
    ColorName: sku.color_name,
    Size: sku.size,
    Quantity: sku.codes.length,
    FacilitySite: T4_CONSTANTS.FacilitySite,
    ProductCategory: T4_CONSTANTS.ProductCategory,
    Gender: T4_CONSTANTS.Gender,
    CfmXfDate: po.cfm_xf_date,
    Codes: sku.codes,
  }));

  return callApi(url, method, appKey, appSecret, businessData);
}

async function cancelarPO(codes) {
  const url = process.env.T4_API_URL;
  const appKey = process.env.T4_APP_KEY;
  const appSecret = process.env.T4_APP_SECRET;
  const method = "cancelpoassociation";

  return callApi(url, method, appKey, appSecret, { Codes: codes });
}

module.exports = { enviarPO, cancelarPO };
