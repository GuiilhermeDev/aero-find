const state = {
  tripType: "round-trip",
  passengers: 1,
  results: [],
  apiReady: false,
  providerName: "Travelpayouts Data API",
  searchMode: "cache",
  selectedAirport: {
    origin: null,
    destination: null
  },
  autocomplete: {
    origin: { highlight: -1, results: [], debounceId: null },
    destination: { highlight: -1, results: [], debounceId: null }
  }
};

const elements = {
  stars: document.getElementById("stars"),
  origin: document.getElementById("origin"),
  destination: document.getElementById("destination"),
  acOrigin: document.getElementById("ac-origin"),
  acDestination: document.getElementById("ac-destination"),
  departureDate: document.getElementById("departure-date"),
  returnDate: document.getElementById("return-date"),
  returnGroup: document.getElementById("return-group"),
  cabin: document.getElementById("cabin"),
  passCount: document.getElementById("pass-count"),
  passMinus: document.getElementById("pass-minus"),
  passPlus: document.getElementById("pass-plus"),
  swapRoute: document.getElementById("swap-route"),
  nonStop: document.getElementById("non-stop"),
  searchButton: document.getElementById("search-button"),
  loading: document.getElementById("loading"),
  errorState: document.getElementById("error-state"),
  resultsSection: document.getElementById("results-section"),
  resultsTitle: document.getElementById("results-title"),
  resultsSubtitle: document.getElementById("results-subtitle"),
  resultsGrid: document.getElementById("results-grid"),
  emptyState: document.getElementById("empty-state"),
  tripButtons: [...document.querySelectorAll(".trip-btn")],
  liveNote: document.getElementById("live-note-text")
};

function createStars() {
  for (let index = 0; index < 120; index += 1) {
    const star = document.createElement("div");
    const size = Math.random() * 2 + 1;
    star.className = "star";
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.left = `${Math.random() * 100}%`;
    star.style.setProperty("--duration", `${(Math.random() * 4 + 2).toFixed(1)}s`);
    star.style.setProperty("--opacity", (Math.random() * 0.55 + 0.15).toFixed(2));
    star.style.animationDelay = `${(Math.random() * 5).toFixed(1)}s`;
    elements.stars.appendChild(star);
  }
}

function setDefaultDates() {
  const today = new Date();
  const departure = new Date(today);
  const returning = new Date(today);
  departure.setDate(today.getDate() + 30);
  returning.setDate(today.getDate() + 37);

  const format = (value) => value.toISOString().split("T")[0];

  elements.departureDate.min = format(today);
  elements.departureDate.value = format(departure);
  elements.returnDate.min = format(departure);
  elements.returnDate.value = format(returning);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatAirportLabel(airport) {
  return `${airport.city} (${airport.iata})`;
}

function formatAirportGroup(airport) {
  return airport.municipality || airport.city || airport.country || airport.iata;
}

function formatAirportType(type) {
  return {
    large_airport: "Grande",
    medium_airport: "Medio",
    small_airport: "Pequeno",
    seaplane_base: "Hidro",
    heliport: "Heliponto"
  }[type] || "Aeroporto";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightMatch(value, query) {
  const normalizedQuery = normalize(query);
  const rawValue = String(value || "");

  if (!normalizedQuery || normalizedQuery.length < 2) {
    return escapeHtml(rawValue);
  }

  const normalizedValue = normalize(rawValue);
  const index = normalizedValue.indexOf(normalizedQuery);

  if (index < 0) {
    return escapeHtml(rawValue);
  }

  const before = rawValue.slice(0, index);
  const match = rawValue.slice(index, index + query.length);
  const after = rawValue.slice(index + query.length);

  return `${escapeHtml(before)}<mark class="ac-match">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function setSelectedAirport(key, airport, inputElement) {
  state.selectedAirport[key] = airport;
  inputElement.dataset.selectedIata = airport?.iata || "";
}

function clearSelectedAirportIfEdited(key, inputElement) {
  const airport = state.selectedAirport[key];

  if (!airport) {
    inputElement.dataset.selectedIata = "";
    return;
  }

  if (inputElement.value.trim() !== formatAirportLabel(airport)) {
    state.selectedAirport[key] = null;
    inputElement.dataset.selectedIata = "";
  }
}

async function fetchAirportSuggestions(query, limit = 8) {
  const response = await fetch(`/api/airports?q=${encodeURIComponent(query)}&limit=${limit}`, {
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Nao foi possivel carregar aeroportos.");
  }

  return payload.results || [];
}

function renderAutocomplete(listElement, inputElement, results, key) {
  const autocompleteState = state.autocomplete[key];
  autocompleteState.results = results;
  autocompleteState.highlight = -1;
  listElement.innerHTML = "";
  let currentGroup = "";
  const query = inputElement.value.trim();

  results.forEach((airport) => {
    const groupLabel = formatAirportGroup(airport);

    if (groupLabel !== currentGroup) {
      const group = document.createElement("div");
      group.className = "ac-group";
      group.textContent = groupLabel;
      listElement.appendChild(group);
      currentGroup = groupLabel;
    }

    const item = document.createElement("div");
    item.className = "ac-item";
    item.innerHTML = `
      <span>
        <div class="ac-city">${highlightMatch(airport.city, query)} (${highlightMatch(airport.iata, query)})</div>
        <div class="ac-country">${highlightMatch(airport.country, query)}${airport.icao ? ` · ICAO ${highlightMatch(airport.icao, query)}` : ""}</div>
      </span>
      <span class="ac-type">${formatAirportType(airport.type)}</span>
      <span class="ac-iata">${airport.iata}</span>
    `;
    item.addEventListener("mousedown", (event) => event.preventDefault());
    item.addEventListener("click", () => {
      inputElement.value = formatAirportLabel(airport);
      setSelectedAirport(key, airport, inputElement);
      listElement.classList.remove("open");
    });
    listElement.appendChild(item);
  });

  listElement.classList.toggle("open", results.length > 0);
}

function highlightAutocomplete(listElement, key) {
  const highlight = state.autocomplete[key].highlight;
  [...listElement.querySelectorAll(".ac-item")].forEach((item, itemIndex) => {
    item.classList.toggle("highlighted", itemIndex === highlight);
  });
}

function scheduleAutocomplete(key, inputElement, listElement) {
  const autocompleteState = state.autocomplete[key];
  const query = inputElement.value.trim();

  clearTimeout(autocompleteState.debounceId);
  autocompleteState.highlight = -1;
  clearSelectedAirportIfEdited(key, inputElement);

  if (query.length < 2) {
    autocompleteState.results = [];
    listElement.classList.remove("open");
    listElement.innerHTML = "";
    return;
  }

  autocompleteState.debounceId = window.setTimeout(async () => {
    try {
      const results = await fetchAirportSuggestions(query, 8);
      renderAutocomplete(listElement, inputElement, results, key);
    } catch (_error) {
      autocompleteState.results = [];
      listElement.classList.remove("open");
    }
  }, 180);
}

function setupAutocomplete(inputElement, listElement, key) {
  inputElement.addEventListener("input", () => {
    scheduleAutocomplete(key, inputElement, listElement);
  });

  inputElement.addEventListener("focus", () => {
    if (inputElement.value.trim().length >= 2) {
      scheduleAutocomplete(key, inputElement, listElement);
    }
  });

  inputElement.addEventListener("keydown", (event) => {
    const autocompleteState = state.autocomplete[key];
    const items = [...listElement.querySelectorAll(".ac-item")];

    if (!items.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      autocompleteState.highlight = Math.min(autocompleteState.highlight + 1, items.length - 1);
      highlightAutocomplete(listElement, key);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      autocompleteState.highlight = Math.max(autocompleteState.highlight - 1, -1);
      highlightAutocomplete(listElement, key);
    }

    if (event.key === "Enter" && autocompleteState.highlight >= 0) {
      event.preventDefault();
      items[autocompleteState.highlight].click();
    }

    if (event.key === "Escape") {
      listElement.classList.remove("open");
    }
  });

  document.addEventListener("click", (event) => {
    if (!inputElement.contains(event.target) && !listElement.contains(event.target)) {
      listElement.classList.remove("open");
    }
  });
}

function swapRouteInputs() {
  const originAirport = state.selectedAirport.origin;
  const destinationAirport = state.selectedAirport.destination;
  const originValue = elements.origin.value;
  const destinationValue = elements.destination.value;
  const originIata = elements.origin.dataset.selectedIata || "";
  const destinationIata = elements.destination.dataset.selectedIata || "";

  elements.origin.value = destinationValue;
  elements.destination.value = originValue;
  elements.origin.dataset.selectedIata = destinationIata;
  elements.destination.dataset.selectedIata = originIata;
  state.selectedAirport.origin = destinationAirport;
  state.selectedAirport.destination = originAirport;
  elements.acOrigin.classList.remove("open");
  elements.acDestination.classList.remove("open");
}

function setTripType(type) {
  state.tripType = type;
  elements.tripButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === type);
  });

  if (type === "one-way") {
    elements.returnGroup.classList.add("hidden");
    elements.returnDate.disabled = true;
    return;
  }

  elements.returnGroup.classList.remove("hidden");
  elements.returnDate.disabled = false;
}

function updatePassengers(delta) {
  state.passengers = Math.max(1, Math.min(9, state.passengers + delta));
  elements.passCount.textContent = String(state.passengers);
}

function setLoading(isLoading) {
  elements.loading.classList.toggle("visible", isLoading);
  elements.searchButton.disabled = isLoading || !state.apiReady;
  elements.searchButton.textContent = isLoading ? "Buscando..." : "Buscar promocoes";
}

function setSearchEnabled(isEnabled) {
  state.apiReady = isEnabled;
  elements.searchButton.disabled = !isEnabled;
}

function setError(message) {
  if (!message) {
    elements.errorState.classList.remove("visible");
    elements.errorState.textContent = "";
    return;
  }

  elements.errorState.classList.add("visible");
  elements.errorState.textContent = message;
}

function formatCurrency(amount, currency) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  return new Date(`${dateString}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(dateTime) {
  if (!dateTime) {
    return "";
  }

  return new Date(dateTime).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStops(stops) {
  if (stops === 0) {
    return "Direto";
  }

  if (stops === 1) {
    return "1 escala";
  }

  return `${stops} escalas`;
}

function buildResultCard(result, index) {
  const article = document.createElement("article");
  const outbound = result.outbound;
  const inbound = result.inbound;
  const cheapestChip = index === 0 ? '<span class="promo-chip">Menor preco</span>' : "";
  const directChip = outbound.stops === 0 ? '<span class="meta-chip">Sem escalas</span>' : "";
  const freshnessChip = result.actual ? '<span class="meta-chip">Oferta atual</span>' : '<span class="meta-chip">Preco em cache</span>';
  const returnLine = inbound
    ? `<div class="return-line"><strong>Volta:</strong> ${formatDate(inbound.departureDate)} · ${formatStops(inbound.stops)}</div>`
    : "";
  const foundLine = result.foundAt
    ? `<div class="return-line"><strong>Encontrada em:</strong> ${formatDateTime(result.foundAt)}</div>`
    : "";
  const cta = result.referenceUrl
    ? `<a class="cta-link" href="${result.referenceUrl}" target="_blank" rel="noopener noreferrer">Abrir referencia</a>`
    : "";

  article.className = "result-card";
  article.innerHTML = `
    <div class="airline-badge">${outbound.origin}</div>
    <div class="flight-main">
      <div class="flight-head">
        <span class="airline-name">${outbound.origin} -> ${outbound.destination}</span>
        ${cheapestChip}
        ${directChip}
        ${freshnessChip}
      </div>
      <div class="itinerary-line">
        <div class="time-block">
          <div class="time-big">${formatDate(outbound.departureDate)}</div>
          <div class="time-city">IDA</div>
        </div>
        <div class="path-block">
          <div class="path-duration">${formatStops(outbound.stops)}</div>
          <div class="path-line">
            <span class="path-plane">PROMO</span>
          </div>
          <div class="path-stops ${outbound.stops === 0 ? "direct" : "connection"}">${result.classLabel || "Classe nao informada"}</div>
        </div>
        <div class="time-block">
          <div class="time-big">${inbound ? formatDate(inbound.departureDate) : "So ida"}</div>
          <div class="time-city">${inbound ? "VOLTA" : outbound.destination}</div>
        </div>
      </div>
      ${returnLine}
      ${foundLine}
    </div>
    <div class="price-block">
      <div class="price-label">Preco encontrado</div>
      <div class="price-value">${formatCurrency(result.totalPrice, result.currency)}</div>
      <div class="price-caption">${result.source} · ${state.passengers} passageiro(s)</div>
      ${cta}
    </div>
  `;

  return article;
}

function renderResults(results, meta) {
  state.results = results;
  elements.resultsGrid.innerHTML = "";

  if (!results.length) {
    elements.emptyState.classList.add("visible");
    elements.resultsTitle.textContent = `${meta.origin} -> ${meta.destination}`;
    elements.resultsSubtitle.textContent =
      meta.emptyReason || `Nenhuma promocao encontrada para ${formatDate(meta.departureDate)}.`;
    return;
  }

  elements.emptyState.classList.remove("visible");
  elements.resultsTitle.textContent = `${meta.origin} -> ${meta.destination}`;

  const tripLabel = meta.returnDate ? `${formatDate(meta.departureDate)} a ${formatDate(meta.returnDate)}` : formatDate(meta.departureDate);
  const directLabel = meta.nonStop ? "somente voos diretos" : "com conexoes permitidas";

  elements.resultsSubtitle.textContent = `${results.length} promocao(oes) encontradas · ${tripLabel} · ${meta.source} · ${meta.freshness} · ${directLabel}`;

  results.forEach((result, index) => {
    elements.resultsGrid.appendChild(buildResultCard(result, index));
  });
}

async function resolveAirportCode(key, inputElement) {
  const selectedAirport = state.selectedAirport[key];

  if (selectedAirport && inputElement.value.trim() === formatAirportLabel(selectedAirport)) {
    return selectedAirport.iata;
  }

  const parenthesesMatch = inputElement.value.trim().toUpperCase().match(/\(([A-Z]{3})\)/);

  if (parenthesesMatch) {
    return parenthesesMatch[1];
  }

  const tokenMatch = inputElement.value.trim().toUpperCase().match(/\b([A-Z]{3})\b/);

  if (tokenMatch) {
    return tokenMatch[1];
  }

  const results = await fetchAirportSuggestions(inputElement.value.trim(), 1);

  if (!results.length) {
    return "";
  }

  setSelectedAirport(key, results[0], inputElement);
  inputElement.value = formatAirportLabel(results[0]);
  return results[0].iata;
}

async function searchFlights() {
  setError("");

  if (!state.apiReady) {
    setError("A busca ainda nao esta disponivel. Verifique se a API serverless esta ativa e configurada.");
    return;
  }

  const departureDate = elements.departureDate.value;
  const returnDate = state.tripType === "round-trip" ? elements.returnDate.value : "";
  const cabin = elements.cabin.value;
  const nonStop = elements.nonStop.checked;

  if (!elements.origin.value.trim() || !elements.destination.value.trim()) {
    setError("Informe origem e destino com um aeroporto valido.");
    return;
  }

  if (!departureDate) {
    setError("Selecione a data de ida.");
    return;
  }

  if (state.tripType === "round-trip" && !returnDate) {
    setError("Selecione a data de volta.");
    return;
  }

  if (state.tripType === "round-trip" && returnDate < departureDate) {
    setError("A data de volta nao pode ser anterior a ida.");
    return;
  }

  setLoading(true);
  elements.liveNote.textContent = `Consultando a ${state.providerName} e ordenando as menores promocoes encontradas.`;

  try {
    const [origin, destination] = await Promise.all([
      resolveAirportCode("origin", elements.origin),
      resolveAirportCode("destination", elements.destination)
    ]);

    if (!origin || !destination) {
      throw new Error("Nao foi possivel identificar um aeroporto valido para origem e destino.");
    }

    if (origin === destination) {
      throw new Error("Origem e destino precisam ser diferentes.");
    }

    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin,
        destination,
        departureDate,
        returnDate,
        adults: state.passengers,
        travelClass: cabin,
        nonStop
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nao foi possivel consultar a API de promocoes.");
    }

    renderResults(payload.results || [], payload.meta);
    elements.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const fallbackMessage =
      error?.name === "TypeError"
        ? "Nao foi possivel acessar /api/search. Rode o projeto pela Vercel ou por `vercel dev`."
        : error.message;

    setError(fallbackMessage);
  } finally {
    setLoading(false);
    elements.liveNote.textContent =
      state.searchMode === "cache"
        ? `Consultando promocoes em cache pela ${state.providerName}.`
        : `Consultando promocoes pela ${state.providerName}.`;
  }
}

async function checkApiAvailability() {
  if (window.location.protocol === "file:") {
    setSearchEnabled(false);
    elements.liveNote.textContent = "Abra o projeto pela Vercel ou `vercel dev` para habilitar a funcao serverless.";
    setError("Este arquivo foi aberto localmente com file://. A rota /api/search so existe quando o projeto roda em um servidor.");
    return;
  }

  try {
    const response = await fetch("/api/health", {
      headers: {
        Accept: "application/json"
      }
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nao foi possivel validar a API.");
    }

    if (!payload.configured) {
      setSearchEnabled(false);
      elements.liveNote.textContent = "API detectada, mas falta o token de ambiente.";
      setError("Configure TRAVELPAYOUTS_API_TOKEN para habilitar as pesquisas.");
      return;
    }

    state.providerName = payload.provider === "travelpayouts" ? "Travelpayouts Data API" : "API de busca";
    state.searchMode = payload.searchMode || "cache";
    setSearchEnabled(true);
    elements.liveNote.textContent =
      state.searchMode === "cache"
        ? `${state.providerName} pronta. Busca por cache habilitada.`
        : `${state.providerName} pronta. Busca habilitada.`;
    setError("");
  } catch (error) {
    setSearchEnabled(false);
    elements.liveNote.textContent = "A API nao respondeu. Verifique se o deploy serverless esta ativo.";
    setError(error.message || "Nao foi possivel conectar a /api/health.");
  }
}

function bindEvents() {
  setupAutocomplete(elements.origin, elements.acOrigin, "origin");
  setupAutocomplete(elements.destination, elements.acDestination, "destination");

  elements.tripButtons.forEach((button) => {
    button.addEventListener("click", () => setTripType(button.dataset.type));
  });

  elements.passMinus.addEventListener("click", () => updatePassengers(-1));
  elements.passPlus.addEventListener("click", () => updatePassengers(1));
  if (elements.swapRoute) {
    elements.swapRoute.addEventListener("click", swapRouteInputs);
  }
  elements.searchButton.addEventListener("click", searchFlights);

  elements.departureDate.addEventListener("change", () => {
    if (elements.returnDate.value && elements.returnDate.value < elements.departureDate.value) {
      elements.returnDate.value = elements.departureDate.value;
    }

    elements.returnDate.min = elements.departureDate.value;
  });
}

async function init() {
  createStars();
  setDefaultDates();
  bindEvents();
  setTripType("round-trip");
  setSearchEnabled(false);
  elements.origin.value = "Sao Paulo - Guarulhos (GRU)";
  elements.destination.value = "Rio de Janeiro - Galeao (GIG)";
  setSelectedAirport("origin", { iata: "GRU", city: "Sao Paulo - Guarulhos" }, elements.origin);
  setSelectedAirport("destination", { iata: "GIG", city: "Rio de Janeiro - Galeao" }, elements.destination);
  await checkApiAvailability();
}

init();
