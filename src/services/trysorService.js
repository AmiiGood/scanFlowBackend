const crypto = require("crypto");
const axios = require("axios");

function buildSign(method, appSecret, businessData) {
  let str = method + appSecret + businessData;
  const first5 = str.substring(0, 5);
  const last5 = str.substring(str.length - 5);
  str = str + first5 + last5;
  return crypto.createHash("md5").update(str).digest("hex").toLowerCase();
}

async function callApi(
  url,
  method,
  appKey,
  appSecret,
  businessDataObj,
  timeoutMs = 35 * 60 * 1000,
) {
  const businessData = JSON.stringify(businessDataObj);
  const sign = buildSign(method, appSecret, businessData);

  console.log(`[Trysor] Llamando ${method} a ${url}`);
  console.log(`[Trysor] BusinessData: ${businessData}`);
  console.log(`[Trysor] Sign: ${sign}`);

  const response = await axios.post(
    url,
    { BusinessData: businessData },
    {
      headers: {
        "Content-Type": "application/json",
        method,
        appKey,
        sign,
      },
      timeout: timeoutMs,
    },
  );

  console.log(`[Trysor] Status: ${response.status}`);
  console.log(
    `[Trysor] Response (primeros 200 chars): ${JSON.stringify(response.data).substring(0, 200)}`,
  );

  const data = response.data;
  const success = String(data?.success ?? "").toLowerCase();
  if (success !== "true" || data?.errorCode) {
    const err = new Error(data?.message || "Error del API T4");
    err.status = 502;
    err.apiResponse = data;
    throw err;
  }

  return data;
}

module.exports = { callApi };
