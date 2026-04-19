function readEnv(name) {
  return String(process.env[name] || "").trim();
}

module.exports = async (_req, res) => {
  const apiToken = readEnv("TRAVELPAYOUTS_API_TOKEN");
  const marker = readEnv("TRAVELPAYOUTS_MARKER");
  const hotelsTrs = readEnv("TRAVELPAYOUTS_HOTELS_TRS") || readEnv("TRAVELPAYOUTS_TRS");
  const flightsConfigured = Boolean(apiToken);
  const hotelsConfigured = Boolean(apiToken && marker && hotelsTrs);
  const hotelsAvailable = true;
  const hotelDirectProvider = readEnv("HOTELS_DIRECT_PROVIDER") || "Klook";

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  res.status(200).end(
    JSON.stringify({
      ok: true,
      configured: flightsConfigured,
      flightsConfigured,
      hotelsAvailable,
      hotelsConfigured,
      hotelDirectProvider,
      provider: "travelpayouts",
      searchMode: "cache",
      hotelMode: hotelsConfigured ? "affiliate-links" : "cpa-links",
      baseUrl: readEnv("TRAVELPAYOUTS_API_BASE_URL") || "https://api.travelpayouts.com/aviasales/v3"
    })
  );
};
