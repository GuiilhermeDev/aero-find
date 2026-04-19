const OURAIRPORTS_AIRPORTS_URL = "https://ourairports.com/data/airports.csv";
const OURAIRPORTS_COUNTRIES_URL = "https://ourairports.com/data/countries.csv";

const cache = {
  airports: null,
  promise: null
};

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(current);
      current = "";

      if (row.length > 1 || row[0]) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [header, ...dataRows] = rows;

  return dataRows.map((dataRow) => {
    const record = {};

    header.forEach((column, columnIndex) => {
      record[column] = dataRow[columnIndex] || "";
    });

    return record;
  });
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildAirportSearchText(airport) {
  return [
    airport.iata,
    airport.icao,
    airport.city,
    airport.name,
    airport.country,
    airport.region,
    ...(airport.keywords || [])
  ]
    .filter(Boolean)
    .join(" ");
}

async function loadAirports() {
  if (cache.airports) {
    return cache.airports;
  }

  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = (async () => {
    const [airportsResponse, countriesResponse] = await Promise.all([
      fetch(OURAIRPORTS_AIRPORTS_URL),
      fetch(OURAIRPORTS_COUNTRIES_URL)
    ]);

    if (!airportsResponse.ok) {
      throw new Error("Nao foi possivel carregar a base mundial de aeroportos.");
    }

    if (!countriesResponse.ok) {
      throw new Error("Nao foi possivel carregar a base de paises.");
    }

    const [airportsCsv, countriesCsv] = await Promise.all([airportsResponse.text(), countriesResponse.text()]);
    const countries = parseCsv(countriesCsv);
    const countryByCode = new Map(countries.map((country) => [country.code, country.name]));

    const airports = parseCsv(airportsCsv)
      .filter((airport) => {
        return (
          airport.iata_code &&
          airport.type !== "closed_airport" &&
          airport.type !== "heliport" &&
          airport.type !== "balloonport"
        );
      })
      .map((airport) => {
        const keywords = airport.keywords
          ? airport.keywords
              .split(",")
              .map((keyword) => keyword.trim())
              .filter(Boolean)
          : [];

        const municipality = airport.municipality || "";
        const name = airport.name || municipality || airport.iata_code;
        const city = municipality ? `${municipality} - ${name}` : name;

        return {
          iata: airport.iata_code,
          icao: airport.icao_code || airport.gps_code || "",
          city,
          municipality,
          name,
          country: countryByCode.get(airport.iso_country) || airport.iso_country || "",
          region: airport.iso_region || "",
          type: airport.type,
          keywords,
          searchText: buildAirportSearchText({
            iata: airport.iata_code,
            icao: airport.icao_code || airport.gps_code || "",
            city,
            name,
            country: countryByCode.get(airport.iso_country) || airport.iso_country || "",
            region: airport.iso_region || "",
            keywords
          })
        };
      });

    cache.airports = airports;
    cache.promise = null;
    return airports;
  })().catch((error) => {
    cache.promise = null;
    throw error;
  });

  return cache.promise;
}

function scoreAirport(airport, query) {
  const normalizedQuery = normalize(query);
  const normalizedIata = normalize(airport.iata);
  const normalizedIcao = normalize(airport.icao);
  const normalizedCity = normalize(airport.city);
  const normalizedMunicipality = normalize(airport.municipality);
  const normalizedName = normalize(airport.name);
  const normalizedCountry = normalize(airport.country);
  const normalizedKeywords = airport.keywords.map(normalize);
  const normalizedSearchText = normalize(airport.searchText);

  let score = 0;

  if (normalizedIata === normalizedQuery) {
    score += 250;
  }

  if (normalizedIcao === normalizedQuery) {
    score += 180;
  }

  if (normalizedMunicipality === normalizedQuery || normalizedName === normalizedQuery) {
    score += 150;
  }

  if (normalizedKeywords.includes(normalizedQuery)) {
    score += 120;
  }

  if (normalizedIata.startsWith(normalizedQuery)) {
    score += 100;
  }

  if (normalizedMunicipality.startsWith(normalizedQuery) || normalizedName.startsWith(normalizedQuery)) {
    score += 90;
  }

  if (normalizedCity.startsWith(normalizedQuery)) {
    score += 80;
  }

  if (normalizedKeywords.some((keyword) => keyword.startsWith(normalizedQuery))) {
    score += 75;
  }

  if (normalizedCountry.startsWith(normalizedQuery)) {
    score += 45;
  }

  if (normalizedSearchText.includes(normalizedQuery)) {
    score += 25;
  }

  if (airport.type === "large_airport") {
    score += 12;
  } else if (airport.type === "medium_airport") {
    score += 8;
  } else if (airport.type === "small_airport") {
    score += 4;
  }

  return score;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.status(405).end(JSON.stringify({ error: "Metodo nao permitido." }));
    return;
  }

  try {
    const query = String(req.query?.q || "").trim();
    const limit = Math.max(1, Math.min(20, Number(req.query?.limit || 8)));

    if (query.length < 2) {
      res.status(200).end(JSON.stringify({ results: [] }));
      return;
    }

    const airports = await loadAirports();
    const results = airports
      .map((airport) => ({ airport, score: scoreAirport(airport, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.airport.city.localeCompare(right.airport.city))
      .slice(0, limit)
      .map((entry) => entry.airport);

    res.status(200).end(JSON.stringify({ results }));
  } catch (error) {
    res.status(500).end(JSON.stringify({ error: error.message || "Nao foi possivel buscar aeroportos." }));
  }
};
