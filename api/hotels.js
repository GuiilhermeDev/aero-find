const TRAVELPAYOUTS_LINKS_API_URL = "https://api.travelpayouts.com/links/v1/create";
const DEFAULT_DIRECT_PROVIDER = "Klook";
const DEFAULT_DIRECT_URL = "https://klook.tpo.lu/nCJk35GH";

function readEnv(name) {
  return String(process.env[name] || "").trim();
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

function buildBookingSearchUrl({ destination, checkin, checkout, adults, rooms }) {
  const url = new URL("https://www.booking.com/searchresults.html");

  url.searchParams.set("ss", destination);
  url.searchParams.set("checkin", checkin);
  url.searchParams.set("checkout", checkout);
  url.searchParams.set("group_adults", String(adults));
  url.searchParams.set("group_children", "0");
  url.searchParams.set("no_rooms", String(rooms));
  url.searchParams.set("selected_currency", "BRL");
  url.searchParams.set("lang", "pt-br");

  return url.toString();
}

async function createAffiliateLinks({ apiToken, marker, trs, links }) {
  const response = await fetch(TRAVELPAYOUTS_LINKS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Access-Token": apiToken
    },
    body: JSON.stringify({
      trs,
      marker,
      shorten: true,
      links
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Nao foi possivel criar links afiliados para hoteis.");
  }

  return payload;
}

function resolveDirectHotelPartner() {
  const provider = readEnv("HOTELS_DIRECT_PROVIDER") || DEFAULT_DIRECT_PROVIDER;
  const urlTemplate = readEnv("HOTELS_DIRECT_URL_TEMPLATE") || readEnv("HOTELS_DIRECT_URL") || DEFAULT_DIRECT_URL;

  return { provider, urlTemplate };
}

function resolveRequestedPartner(requestedPartner, directPartner) {
  const normalized = String(requestedPartner || "auto").trim().toLowerCase();

  if (normalized === "travelpayouts" || normalized === "booking") {
    return {
      type: "travelpayouts",
      provider: "Booking.com"
    };
  }

  if (normalized === "klook") {
    return {
      type: "direct",
      provider: "Klook",
      urlTemplate: DEFAULT_DIRECT_URL
    };
  }

  return {
    type: "auto",
    provider: directPartner.provider,
    urlTemplate: directPartner.urlTemplate
  };
}

function fillUrlTemplate(urlTemplate, params) {
  return String(urlTemplate || "").replace(/\{(\w+)\}/g, (_match, key) => {
    return encodeURIComponent(params[key] ?? "");
  });
}

function buildResponse({
  destination,
  checkin,
  checkout,
  adults,
  rooms,
  wifi,
  provider,
  source,
  mode,
  url,
  ctaLabel,
  notes
}) {
  return {
    results: [
      {
        id: `${String(provider || "hotel").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-hotel-search`,
        kind: "hotel-link",
        provider,
        title: destination,
        source,
        affiliateUrl: url,
        originalUrl: url,
        ctaLabel,
        badge: "HTL",
        summary: `Busca preenchida para ${adults} hospede(s) e ${rooms} quarto(s).`,
        notes
      }
    ],
    meta: {
      kind: "hotels",
      destination,
      checkin,
      checkout,
      adults,
      rooms,
      wifi,
      source,
      mode,
      provider
    }
  };
}

function buildNotes({ wifi, dynamic, baseMessage, extraMessage }) {
  const notes = [dynamic ? "Busca enviada ao parceiro com parametros dinamicos." : baseMessage];

  if (wifi) {
    notes.push("Wi-Fi marcado como preferencia visual.");
  }

  if (extraMessage) {
    notes.push(extraMessage);
  }

  return notes;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).end(JSON.stringify({ error: "Metodo nao permitido." }));
    return;
  }

  try {
    const payload = readPayload(req);
    const apiToken = readEnv("TRAVELPAYOUTS_API_TOKEN");
    const marker = Number(readEnv("TRAVELPAYOUTS_MARKER") || "");
    const trs = Number(readEnv("TRAVELPAYOUTS_HOTELS_TRS") || readEnv("TRAVELPAYOUTS_TRS") || "");
    const destination = String(payload.destination || "").trim();
    const checkin = String(payload.checkin || "").trim();
    const checkout = String(payload.checkout || "").trim();
    const adults = Math.max(1, Math.min(20, Number(payload.adults || 1)));
    const rooms = Math.max(1, Math.min(10, Number(payload.rooms || 1)));
    const wifi = Boolean(payload.wifi);
    const directPartner = resolveDirectHotelPartner();
    const requestedPartner = resolveRequestedPartner(payload.affiliatePartner, directPartner);

    if (!destination || !checkin || !checkout) {
      res.status(400).end(JSON.stringify({ error: "Destino, check-in e check-out sao obrigatorios." }));
      return;
    }

    if (checkout <= checkin) {
      res.status(400).end(JSON.stringify({ error: "A data de check-out deve ser posterior ao check-in." }));
      return;
    }

    const originalLink = buildBookingSearchUrl({
      destination,
      checkin,
      checkout,
      adults,
      rooms
    });

    const effectiveDirectUrlTemplate = requestedPartner.type === "direct" ? requestedPartner.urlTemplate : directPartner.urlTemplate;
    const effectiveDirectProvider = requestedPartner.type === "direct" ? requestedPartner.provider : directPartner.provider;
    const directUrl = fillUrlTemplate(effectiveDirectUrlTemplate, {
      destination,
      checkin,
      checkout,
      adults,
      rooms
    });
    const usesDynamicTemplate = /\{(\w+)\}/.test(effectiveDirectUrlTemplate);
    const travelpayoutsReady = Boolean(apiToken && marker && trs);

    if (requestedPartner.type === "direct") {
      res.status(200).end(
        JSON.stringify(
          buildResponse({
            destination,
            checkin,
            checkout,
            adults,
            rooms,
            wifi,
            provider: effectiveDirectProvider,
            source: `Link CPA ${effectiveDirectProvider}`,
            mode: "cpa-links",
            url: directUrl,
            ctaLabel: `Abrir ${effectiveDirectProvider}`,
            notes: buildNotes({
              wifi,
              dynamic: usesDynamicTemplate,
              baseMessage: "Link CPA temporario configurado para o parceiro.",
              extraMessage: "Rastreamento afiliado da Travelpayouts nao foi solicitado neste filtro."
            })
          })
        )
      );
      return;
    }

    if (!travelpayoutsReady && requestedPartner.type === "travelpayouts") {
      res.status(200).end(
        JSON.stringify(
          buildResponse({
            destination,
            checkin,
            checkout,
            adults,
            rooms,
            wifi,
            provider: "Booking.com",
            source: "Booking.com direto",
            mode: "direct-links",
            url: originalLink,
            ctaLabel: "Abrir Booking.com",
            notes: buildNotes({
              wifi,
              dynamic: true,
              baseMessage: "Busca enviada ao Booking.com com parametros dinamicos.",
              extraMessage: "A afiliacao Travelpayouts / Booking ainda nao esta configurada nesta conta."
            })
          })
        )
      );
      return;
    }

    if (!travelpayoutsReady && requestedPartner.type === "auto") {
      res.status(200).end(
        JSON.stringify(
          buildResponse({
            destination,
            checkin,
            checkout,
            adults,
            rooms,
            wifi,
            provider: effectiveDirectProvider,
            source: `Link CPA ${effectiveDirectProvider}`,
            mode: "cpa-links",
            url: directUrl,
            ctaLabel: `Abrir ${effectiveDirectProvider}`,
            notes: buildNotes({
              wifi,
              dynamic: usesDynamicTemplate,
              baseMessage: "Link CPA temporario configurado para o parceiro.",
              extraMessage: "Rastreamento afiliado da Travelpayouts ainda nao configurado para hoteis."
            })
          })
        )
      );
      return;
    }

    const partnerPayload = await createAffiliateLinks({
      apiToken,
      marker,
      trs,
      links: [
        {
          url: originalLink,
          sub_id: "aerofind-hotels"
        }
      ]
    });

    const partnerLink = partnerPayload?.result?.links?.[0];

    if (partnerLink && partnerLink.code === "success" && partnerLink.partner_url) {
      res.status(200).end(
        JSON.stringify(
          buildResponse({
            destination,
            checkin,
            checkout,
            adults,
            rooms,
            wifi,
            provider: "Booking.com",
            source: "Travelpayouts partner links API",
            mode: "affiliate-links",
            url: partnerLink.partner_url,
            ctaLabel: "Abrir busca afiliada",
            notes: buildNotes({
              wifi,
              dynamic: true,
              baseMessage: "Busca enviada ao Booking.com com parametros dinamicos.",
              extraMessage: "As tarifas finais aparecem no parceiro."
            })
          })
        )
      );
      return;
    }

    if (requestedPartner.type === "travelpayouts") {
      res.status(200).end(
        JSON.stringify(
          buildResponse({
            destination,
            checkin,
            checkout,
            adults,
            rooms,
            wifi,
            provider: "Booking.com",
            source: "Booking.com direto",
            mode: "direct-links",
            url: originalLink,
            ctaLabel: "Abrir Booking.com",
            notes: buildNotes({
              wifi,
              dynamic: true,
              baseMessage: "Busca enviada ao Booking.com com parametros dinamicos.",
              extraMessage: "Nao foi possivel gerar o link afiliado da Travelpayouts nesta tentativa."
            })
          })
        )
      );
      return;
    }

    res.status(200).end(
      JSON.stringify(
        buildResponse({
          destination,
          checkin,
          checkout,
          adults,
          rooms,
          wifi,
          provider: effectiveDirectProvider,
          source: `Link CPA ${effectiveDirectProvider}`,
          mode: "cpa-links",
          url: directUrl,
          ctaLabel: `Abrir ${effectiveDirectProvider}`,
          notes: buildNotes({
            wifi,
            dynamic: usesDynamicTemplate,
            baseMessage: "Link CPA temporario configurado para o parceiro.",
            extraMessage: "A Travelpayouts nao gerou um link afiliado de hoteis nesta tentativa."
          })
        })
      )
    );
  } catch (error) {
    const payload = (() => {
      try {
        return readPayload(req);
      } catch (_payloadError) {
        return {};
      }
    })();
    const destination = String(payload.destination || "").trim();
    const checkin = String(payload.checkin || "").trim();
    const checkout = String(payload.checkout || "").trim();
    const adults = Math.max(1, Math.min(20, Number(payload.adults || 1)));
    const rooms = Math.max(1, Math.min(10, Number(payload.rooms || 1)));
    const wifi = Boolean(payload.wifi);
    const directPartner = resolveDirectHotelPartner();
    const directUrl = fillUrlTemplate(directPartner.urlTemplate, {
      destination,
      checkin,
      checkout,
      adults,
      rooms
    });
    const usesDynamicTemplate = /\{(\w+)\}/.test(directPartner.urlTemplate);

    res.status(200).end(
      JSON.stringify(
        buildResponse({
          destination,
          checkin,
          checkout,
          adults,
          rooms,
          wifi,
          provider: directPartner.provider,
          source: `Link CPA ${directPartner.provider}`,
          mode: "cpa-links",
          url: directUrl,
          ctaLabel: `Abrir ${directPartner.provider}`,
          notes: buildNotes({
            wifi,
            dynamic: usesDynamicTemplate,
            baseMessage: "Link CPA temporario configurado para o parceiro.",
            extraMessage: "Nao foi possivel processar a busca com o parceiro solicitado nesta tentativa."
          })
        })
      )
    );
  }
};
