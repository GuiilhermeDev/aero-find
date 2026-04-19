module.exports = async (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  res.status(200).end(
    JSON.stringify({
      ok: true,
      configured: Boolean(process.env.TRAVELPAYOUTS_API_TOKEN),
      provider: "travelpayouts",
      searchMode: "cache",
      baseUrl: process.env.TRAVELPAYOUTS_API_BASE_URL || "https://api.travelpayouts.com/aviasales/v3"
    })
  );
};
