const TRAVELPAYOUTS_API_BASE_URL =
  process.env.TRAVELPAYOUTS_API_BASE_URL || "https://api.travelpayouts.com/aviasales/v3";

const METRO_AIRPORTS = {
  BUE: ["AEP", "EZE"],
  CHI: ["ORD", "MDW"],
  LON: ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"],
  MIL: ["MXP", "LIN", "BGY"],
  NYC: ["JFK", "LGA", "EWR"],
  PAR: ["CDG", "ORY", "BVA"],
  RIO: ["GIG", "SDU", "RRJ", "SNZ"],
  ROM: ["FCO", "CIA"],
  SAO: ["GRU", "CGH", "VCP"],
  TYO: ["HND", "NRT"],
  WAS: ["IAD", "DCA", "BWI"]
};

const AIRPORT_TO_METRO = Object.entries(METRO_AIRPORTS).reduce((lookup, [metro, airports]) => {
  airports.forEach((airport) => {
    lookup[airport] = metro;
  });

  return lookup;
}, {});

function parseBoolean(value) {
  return value === true || value === "true";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildReferenceUrl(origin, destination, departureDate, returnDate) {
  const segments = [`Flights from ${origin} to ${destination} on ${departureDate}`];

  if (returnDate) {
    segments.push(`returning ${returnDate}`);
  }

  return `https://www.google.com/travel/flights?q=${encodeURIComponent(segments.join(" "))}`;
}

function buildProviderLink(link, origin, destination, departureDate, returnDate) {
  if (typeof link === "string" && link.trim()) {
    if (link.startsWith("http://") || link.startsWith("https://")) {
      return link;
    }

    if (link.startsWith("/")) {
      return `https://www.aviasales.com${link}`;
    }

    return `https://www.aviasales.com/search/${link}`;
  }

  return buildReferenceUrl(origin, destination, departureDate, returnDate);
}

function readPayload(req) {
  if (req.method === "GET") {
    return req.query || {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_error) {
      const invalidJsonError = new Error("Invalid JSON");
      invalidJsonError.statusCode = 400;
      throw invalidJsonError;
    }
  }

  return req.body || {};
}

function mapTripClass(value) {
  return {
    0: "Economica",
    1: "Executiva",
    2: "Primeira Classe"
  }[Number(value)] || "Nao informado";
}

function parseRequestedTravelClass(value) {
  const normalized = String(value || "ECONOMY").trim().toUpperCase();

  if (normalized === "ECONOMY") {
    return {
      code: normalized,
      label: "Economica",
      tripClass: 0,
      supported: true
    };
  }

  if (normalized === "BUSINESS") {
    return {
      code: normalized,
      label: "Executiva",
      tripClass: 1,
      supported: true
    };
  }

  if (normalized === "FIRST") {
    return {
      code: normalized,
      label: "Primeira Classe",
      tripClass: 2,
      supported: true
    };
  }

  if (normalized === "PREMIUM_ECONOMY") {
    return {
      code: normalized,
      label: "Premium Economy",
      tripClass: null,
      supported: false
    };
  }

  return {
    code: "ECONOMY",
    label: "Economica",
    tripClass: 0,
    supported: true
  };
}

function mapOffer(offer, requestMeta) {
  const totalPrice = Number(offer.price ?? offer.value ?? 0);
  const outboundDateTime = offer.departure_at || offer.departureAt || null;
  const inboundDateTime = offer.return_at || offer.returnAt || null;
  const outboundDate = offer.depart_date || (outboundDateTime ? outboundDateTime.slice(0, 10) : requestMeta.departureDate);
  const inboundDate = offer.return_date || (inboundDateTime ? inboundDateTime.slice(0, 10) : requestMeta.returnDate);

  return {
    id: [
      offer.origin_airport || offer.origin || requestMeta.origin,
      offer.destination_airport || offer.destination || requestMeta.destination,
      outboundDate,
      inboundDate || "oneway",
      totalPrice
    ].join("-"),
    source: "Travelpayouts Cache",
    currency: offer.currency || requestMeta.currency || "BRL",
    totalPrice,
    classLabel:
      offer.trip_class !== undefined
        ? mapTripClass(offer.trip_class)
        : requestMeta.travelClassApplied
          ? requestMeta.travelClassLabel
          : "Classe nao informada pela API",
    foundAt: offer.found_at || offer.search_date || null,
    actual: offer.actual === undefined ? false : Boolean(offer.actual),
    distance: offer.distance || null,
    airline: offer.airline || null,
    gate: offer.gate || null,
    outbound: {
      origin: offer.origin_airport || offer.origin || requestMeta.origin,
      destination: offer.destination_airport || offer.destination || requestMeta.destination,
      departureDate: outboundDate,
      departureAt: outboundDateTime,
      stops: Number(offer.transfers ?? offer.number_of_changes ?? 0)
    },
    inbound: inboundDate
      ? {
          origin: offer.destination_airport || offer.destination || requestMeta.destination,
          destination: offer.origin_airport || offer.origin || requestMeta.origin,
          departureDate: inboundDate,
          departureAt: inboundDateTime,
          stops: Number(offer.return_transfers ?? offer.number_of_changes ?? 0)
        }
      : null,
    referenceUrl: buildProviderLink(
      offer.link,
      requestMeta.origin,
      requestMeta.destination,
      requestMeta.departureDate,
      requestMeta.returnDate
    )
  };
}

async function fetchWithRetry(url, options, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError;
}

async function fetchTravelpayoutsOffers(apiToken, params) {
  const url = `${TRAVELPAYOUTS_API_BASE_URL}/prices_for_dates?${params.toString()}`;
  const response = await fetchWithRetry(url, {
    headers: {
      "X-Access-Token": apiToken,
      Accept: "application/json"
    }
  });

  const responsePayload = await response.json();

  if (!response.ok) {
    throw new Error(responsePayload?.error || "A busca de promocoes falhou na Travelpayouts.");
  }

  if (responsePayload?.success === false) {
    throw new Error(responsePayload?.error || "A Travelpayouts rejeitou a busca.");
  }

  return responsePayload;
}

function buildLocationVariants(code) {
  const metro = METRO_AIRPORTS[code] ? code : AIRPORT_TO_METRO[code] || null;
  const metroAirports = metro ? METRO_AIRPORTS[metro] || [] : [];

  return unique([code, metro, ...metroAirports]).slice(0, 5);
}

function buildSearchParams({ origin, destination, departureDate, returnDate, nonStop, currency, useMonth }) {
  const params = new URLSearchParams({
    origin,
    destination,
    departure_at: useMonth ? departureDate.slice(0, 7) : departureDate,
    direct: nonStop ? "true" : "false",
    one_way: returnDate ? "false" : "true",
    sorting: "price",
    limit: "15",
    page: "1",
    market: "br",
    currency,
    cy: currency
  });

  if (returnDate) {
    params.set("return_at", useMonth ? returnDate.slice(0, 7) : returnDate);
  }

  return params;
}

function buildSearchPlans({ origin, destination, departureDate, returnDate, nonStop, currency }) {
  const plans = [];
  const seen = new Set();
  const originVariants = buildLocationVariants(origin);
  const destinationVariants = buildLocationVariants(destination);

  function pushPlan(planOrigin, planDestination, useMonth, label) {
    const key = `${planOrigin}-${planDestination}-${useMonth ? "month" : "exact"}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    plans.push({
      origin: planOrigin,
      destination: planDestination,
      label,
      useMonth,
      params: buildSearchParams({
        origin: planOrigin,
        destination: planDestination,
        departureDate,
        returnDate,
        nonStop,
        currency,
        useMonth
      })
    });
  }

  pushPlan(origin, destination, false, "rota exata");
  pushPlan(origin, destination, true, "rota exata por mes");

  destinationVariants
    .filter((variant) => variant !== destination)
    .slice(0, 3)
    .forEach((variant) => {
      pushPlan(origin, variant, false, `destino alternativo ${variant}`);
      pushPlan(origin, variant, true, `destino alternativo ${variant} por mes`);
    });

  originVariants
    .filter((variant) => variant !== origin)
    .slice(0, 2)
    .forEach((variant) => {
      pushPlan(variant, destination, false, `origem alternativa ${variant}`);
      pushPlan(variant, destination, true, `origem alternativa ${variant} por mes`);
    });

  return plans.slice(0, 10);
}

function createEmptyReason(attempts, origin, destination, travelClassLabel) {
  const attemptedRoutes = unique(attempts.map((attempt) => `${attempt.origin}-${attempt.destination}`));
  const classSuffix = travelClassLabel ? ` na classe ${travelClassLabel.toLowerCase()}` : "";

  if (attemptedRoutes.length > 1) {
    return `A Travelpayouts nao possui tarifas em cache para ${origin} -> ${destination}${classSuffix} nas combinacoes consultadas. Isso nao significa ausencia de voos em tempo real.`;
  }

  return `A Travelpayouts nao possui tarifas em cache para ${origin} -> ${destination}${classSuffix} nesse periodo. Isso nao significa ausencia de voos em tempo real.`;
}

function createTravelClassMeta(selectedClass) {
  return {
    travelClass: selectedClass.code,
    travelClassLabel: selectedClass.label,
    travelClassApplied: false,
    travelClassNotice:
      "A classe selecionada foi registrada como preferencia, mas esse endpoint de cache nem sempre informa a cabine real da tarifa."
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).end(JSON.stringify({ error: "Metodo nao permitido." }));
    return;
  }

  try {
    const apiToken = process.env.TRAVELPAYOUTS_API_TOKEN;

    if (!apiToken) {
      throw new Error("A variavel TRAVELPAYOUTS_API_TOKEN nao esta configurada.");
    }

    const payload = readPayload(req);
    const origin = String(payload.origin || "").trim().toUpperCase();
    const destination = String(payload.destination || "").trim().toUpperCase();
    const departureDate = String(payload.departureDate || "").trim();
    const returnDate = String(payload.returnDate || "").trim();
    const nonStop = parseBoolean(payload.nonStop);
    const requestedTravelClass = parseRequestedTravelClass(payload.travelClass);
    const currency = "brl";

    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).end(JSON.stringify({ error: "Origem e destino devem ser codigos IATA validos." }));
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
      res.status(400).end(JSON.stringify({ error: "A data de ida e obrigatoria no formato YYYY-MM-DD." }));
      return;
    }

    if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
      res.status(400).end(JSON.stringify({ error: "A data de volta deve estar no formato YYYY-MM-DD." }));
      return;
    }

    if (returnDate && returnDate < departureDate) {
      res.status(400).end(JSON.stringify({ error: "A data de volta deve ser posterior a de ida." }));
      return;
    }

    const attempts = [];
    const plans = buildSearchPlans({ origin, destination, departureDate, returnDate, nonStop, currency });
    let responsePayload = null;
    let matchedPlan = null;

    const planResults = await Promise.all(
      plans.map(async (plan) => {
        try {
          const payloadResponse = await fetchTravelpayoutsOffers(apiToken, plan.params);
          const data = Array.isArray(payloadResponse.data) ? payloadResponse.data : [];

          return {
            plan,
            payloadResponse,
            data,
            success: true
          };
        } catch (error) {
          return {
            plan,
            payloadResponse: null,
            data: [],
            success: false,
            error
          };
        }
      })
    );

    for (const result of planResults) {
      if (result.success) {
        attempts.push({
          origin: result.plan.origin,
          destination: result.plan.destination,
          label: result.plan.label,
          granularity: result.plan.useMonth ? "month" : "exact",
          count: result.data.length
        });

        if (result.data.length > 0 && !responsePayload) {
          responsePayload = result.payloadResponse;
          matchedPlan = result.plan;
        }
      } else {
        attempts.push({
          origin: result.plan.origin,
          destination: result.plan.destination,
          label: result.plan.label,
          granularity: result.plan.useMonth ? "month" : "exact",
          count: 0,
          error: result.error?.message
        });
      }
    }

    const rawResults = ((responsePayload && responsePayload.data) || []).map((offer) => ({
      ...offer,
      currency: String(responsePayload?.currency || currency).toUpperCase()
    }));
    const canApplyTravelClass = requestedTravelClass.supported && rawResults.some((offer) => offer.trip_class !== undefined);
    const filteredOffers = canApplyTravelClass
      ? rawResults.filter((offer) => Number(offer.trip_class) === requestedTravelClass.tripClass)
      : rawResults;
    const travelClassMeta = canApplyTravelClass
      ? {
          travelClass: requestedTravelClass.code,
          travelClassLabel: requestedTravelClass.label,
          travelClassApplied: true,
          travelClassNotice: ""
        }
      : createTravelClassMeta(requestedTravelClass);

    const requestMeta = {
      origin,
      destination,
      departureDate,
      returnDate,
      currency: String(responsePayload?.currency || currency).toUpperCase(),
      travelClassLabel: travelClassMeta.travelClassLabel,
      travelClassApplied: travelClassMeta.travelClassApplied
    };

    const results = filteredOffers
      .map((offer) => mapOffer(offer, requestMeta))
      .sort((left, right) => left.totalPrice - right.totalPrice)
      .filter((offer, index, offers) => {
        return offers.findIndex((candidate) => candidate.id === offer.id) === index;
      })
      .slice(0, 30);

    res.status(200).end(
      JSON.stringify({
        meta: {
          origin,
          destination,
          departureDate,
          returnDate,
          adults: Math.max(1, Math.min(9, Number(payload.adults || 1))),
          nonStop,
          travelClass: travelClassMeta.travelClass,
          travelClassLabel: travelClassMeta.travelClassLabel,
          travelClassApplied: travelClassMeta.travelClassApplied,
          travelClassNotice: travelClassMeta.travelClassNotice,
          currency: requestMeta.currency,
          source: "Travelpayouts Data API",
          provider: "travelpayouts",
          searchMode: "cache",
          freshness: "Cache de buscas dos ultimos dias",
          matchedStrategy: matchedPlan ? matchedPlan.label : null,
          referenceUrl: buildReferenceUrl(origin, destination, departureDate, returnDate),
          emptyReason: results.length ? "" : createEmptyReason(attempts, origin, destination, requestMeta.travelClassLabel),
          attempts
        },
        results
      })
    );
  } catch (error) {
    console.error("Search API Error:", error);
    res.status(error.statusCode || 500).end(
      JSON.stringify({
        error: error.message || "Nao foi possivel processar a busca."
      })
    );
  }
};
