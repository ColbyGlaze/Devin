const DEFAULT_VIEW = {
  center: [39.5, -98.35],
  zoom: 4,
};

const DEFAULT_PHOTO = "./assets/devin-photo.png";

const state = {
  pins: [],
  photoUrl: DEFAULT_PHOTO,
  isFileProtocol: window.location.protocol === "file:",
  isAdmin: false,
  placementArmed: false,
  activePinId: null,
  editingPinId: null,
  panelOpen: false,
};

let map;
let markersLayer;
const markerRegistry = new Map();

const els = {
  placeName: document.getElementById("placeName"),
  placeRating: document.getElementById("placeRating"),
  placeDescription: document.getElementById("placeDescription"),
  adminPassword: document.getElementById("adminPassword"),
  adminStatus: document.getElementById("adminStatus"),
  authButton: document.getElementById("authButton"),
  logoutButton: document.getElementById("logoutButton"),
  menuToggle: document.getElementById("menuToggle"),
  menuClose: document.getElementById("menuClose"),
  controlPanel: document.getElementById("controlPanel"),
  formTitle: document.getElementById("formTitle"),
  armPinButton: document.getElementById("armPinButton"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  placementStatus: document.getElementById("placementStatus"),
  pinCount: document.getElementById("pinCount"),
  modeBadge: document.getElementById("modeBadge"),
  protocolNotice: document.getElementById("protocolNotice"),
};

init();

async function init() {
  if (state.isFileProtocol) {
    els.protocolNotice.classList.remove("is-hidden");
  }

  initMap();
  bindEvents();
  setPanelOpen(false);
  updatePlacementUi();
  updateAdminUi();

  if (!state.isFileProtocol) {
    await Promise.all([loadSession(), loadPins()]);
  }
}

function bindEvents() {
  els.menuToggle.addEventListener("click", () => {
    setPanelOpen(!state.panelOpen);
  });

  els.menuClose.addEventListener("click", () => {
    setPanelOpen(false);
  });

  els.cancelEditButton.addEventListener("click", () => {
    exitEditMode("Edit canceled.");
  });

  els.authButton.addEventListener("click", async () => {
    await login();
  });

  els.logoutButton.addEventListener("click", async () => {
    await logout();
  });

  els.adminPassword.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await login();
    }
  });

  els.armPinButton.addEventListener("click", () => {
    setPanelOpen(true);

    if (!state.isAdmin) {
      els.placementStatus.textContent = "Unlock admin mode to add or edit pins.";
      return;
    }

    if (state.editingPinId) {
      void savePinEdit();
      return;
    }

    if (state.placementArmed) {
      state.placementArmed = false;
      updatePlacementUi("Pin placement canceled.");
      return;
    }

    const validation = validateForm();
    if (!validation.valid) {
      els.placementStatus.textContent = validation.message;
      return;
    }

    state.placementArmed = true;
    updatePlacementUi("Click a location on the map to drop this pin.");
  });
}

function initMap() {
  if (state.isFileProtocol) return;

  map = L.map("map", {
    zoomControl: false,
    minZoom: 3,
    maxZoom: 18,
  }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

  L.control.zoom({
    position: "bottomright",
  }).addTo(map);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOrigin: true,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.whenReady(() => {
    window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
  });
  window.addEventListener("resize", () => map.invalidateSize());

  map.on("click", async (event) => {
    await handleMapPlacement(event);
  });
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    const payload = await response.json();
    state.isAdmin = Boolean(payload.isAdmin);
  } catch (error) {
    state.isAdmin = false;
  }
  updateAdminUi();
}

async function loadPins() {
  try {
    const response = await fetch("/api/pins", { credentials: "same-origin" });
    const payload = await response.json();
    state.pins = Array.isArray(payload.pins) ? payload.pins : [];
  } catch (error) {
    state.pins = [];
  }
  renderPins();
}

async function login() {
  const password = els.adminPassword.value;
  if (!password) {
    els.adminStatus.textContent = "Enter the admin password first.";
    return;
  }

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      els.adminStatus.textContent = "Password not accepted.";
      return;
    }

    state.isAdmin = true;
    els.adminPassword.value = "";
    els.adminStatus.textContent = "Admin unlocked. You can add pins now.";
    updateAdminUi();
  } catch (error) {
    els.adminStatus.textContent = "Could not reach the server.";
  }
}

async function logout() {
  try {
    await fetch("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch (error) {
    // no-op
  }

  state.isAdmin = false;
  state.placementArmed = false;
  state.editingPinId = null;
  updateAdminUi();
  updatePlacementUi("Admin mode locked.");
}

async function handleMapPlacement(event) {
  if (state.isFileProtocol || !state.placementArmed || !state.isAdmin) return;

  const validation = validateForm();
  if (!validation.valid) {
    state.placementArmed = false;
    updatePlacementUi(validation.message);
    return;
  }

  const pinDraft = {
    name: els.placeName.value.trim(),
    rating: Number(els.placeRating.value),
    description: els.placeDescription.value.trim(),
    lat: round(event.latlng.lat),
    lng: round(event.latlng.lng),
  };

  try {
    const response = await fetch("/api/pins", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinDraft),
    });

    if (!response.ok) {
      if (response.status === 401) {
        state.isAdmin = false;
        updateAdminUi();
        updatePlacementUi("Admin session expired. Unlock again to add pins.");
        return;
      }
      updatePlacementUi("Could not save that pin.");
      return;
    }

    const payload = await response.json();
    state.pins = Array.isArray(payload.pins) ? payload.pins : state.pins;
    state.placementArmed = false;
    state.activePinId = payload.pin?.id ?? null;
    renderPins();
    clearForm();
    setPanelOpen(false);
    if (state.activePinId) {
      focusPin(state.activePinId, { zoom: Math.max(map.getZoom(), 4), openPopup: true });
    }
    updatePlacementUi(`Pin added for ${pinDraft.name}.`);
  } catch (error) {
    updatePlacementUi("Could not reach the server.");
  }
}

async function savePinEdit() {
  if (!state.editingPinId || !state.isAdmin) return;

  const validation = validateForm();
  if (!validation.valid) {
    updatePlacementUi(validation.message);
    return;
  }

  const existingPin = state.pins.find((pin) => pin.id === state.editingPinId);
  if (!existingPin) {
    exitEditMode("That pin could not be found.");
    return;
  }

  const updatedDraft = {
    name: els.placeName.value.trim(),
    rating: Number(els.placeRating.value),
    description: els.placeDescription.value.trim(),
    lat: existingPin.lat,
    lng: existingPin.lng,
  };

  try {
    const response = await fetch(`/api/pins/${encodeURIComponent(state.editingPinId)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedDraft),
    });

    if (!response.ok) {
      if (response.status === 401) {
        state.isAdmin = false;
        state.editingPinId = null;
        updateAdminUi();
        updatePlacementUi("Admin session expired. Unlock again to edit pins.");
        return;
      }
      updatePlacementUi("Could not save those pin changes.");
      return;
    }

    const payload = await response.json();
    state.pins = Array.isArray(payload.pins) ? payload.pins : state.pins;
    state.activePinId = payload.pin?.id ?? state.activePinId;
    renderPins();
    exitEditMode(`Pin updated for ${updatedDraft.name}.`, { preserveForm: false, keepPanelOpen: false });
    if (state.activePinId) {
      focusPin(state.activePinId, { zoom: Math.max(map.getZoom(), 5), openPopup: true });
    }
  } catch (error) {
    updatePlacementUi("Could not reach the server.");
  }
}

function renderPins() {
  els.pinCount.textContent = String(state.pins.length);

  if (state.isFileProtocol) return;

  markersLayer.clearLayers();
  markerRegistry.clear();

  state.pins.forEach((pin) => {
    const marker = L.marker([pin.lat, pin.lng], {
      riseOnHover: true,
      icon: L.divIcon({
        className: "custom-pin",
        html: createPinMarkup(pin),
        iconSize: [54, 74],
        iconAnchor: [27, 66],
        popupAnchor: [0, -58],
      }),
    });

    marker.bindPopup(createPopupMarkup(pin), {
      autoPanPadding: [36, 36],
      closeButton: false,
      offset: [0, -6],
    });
    marker.on("click", () => {
      focusPin(pin.id, { zoom: Math.max(map.getZoom(), 5), openPopup: false });
      if (state.isAdmin) {
        enterEditMode(pin.id);
      }
    });
    marker.on("popupopen", () => {
      focusPin(pin.id, { zoom: Math.max(map.getZoom(), 5), openPopup: false });
    });
    marker.addTo(markersLayer);
    markerRegistry.set(pin.id, marker);
  });

  if (state.activePinId && markerRegistry.has(state.activePinId)) {
    applyActiveMarkerState();
  }
}

function createPinMarkup(pin) {
  return `
    <article class="pin-badge ${pin.id === state.activePinId ? "is-active" : ""}" aria-label="${escapeHtml(pin.name)}">
      <img class="pin-avatar" src="${state.photoUrl}" alt="${escapeHtml(pin.name)}">
      <span class="pin-stem"></span>
    </article>
  `;
}

function createPopupMarkup(pin) {
  return `
    <article class="popup-card">
      <img src="${state.photoUrl}" alt="${escapeHtml(pin.name)}">
      <h3>${escapeHtml(pin.name)}</h3>
      <p><strong>Location:</strong> ${pin.lat}, ${pin.lng}</p>
      <p><strong>Rating:</strong> ${pin.rating}/10</p>
      <p><strong>Description:</strong> ${escapeHtml(pin.description)}</p>
    </article>
  `;
}

function validateForm() {
  const name = els.placeName.value.trim();
  const rating = Number(els.placeRating.value);
  const description = els.placeDescription.value.trim();

  if (!name) {
    return { valid: false, message: "Enter a name before placing a pin." };
  }

  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    return { valid: false, message: "Rating must be a number from 1 to 10." };
  }

  if (!description) {
    return { valid: false, message: "Add a description before placing a pin." };
  }

  return { valid: true };
}

function clearForm() {
  els.placeName.value = "";
  els.placeRating.value = "8";
  els.placeDescription.value = "";
}

function enterEditMode(pinId) {
  const pin = state.pins.find((entry) => entry.id === pinId);
  if (!pin || !state.isAdmin) return;

  state.editingPinId = pinId;
  state.placementArmed = false;
  els.placeName.value = pin.name;
  els.placeRating.value = String(pin.rating);
  els.placeDescription.value = pin.description;
  setPanelOpen(true);
  updatePlacementUi(`Editing ${pin.name}. Save changes when ready.`);
}

function exitEditMode(message, options = {}) {
  const preserveForm = options.preserveForm ?? false;
  const keepPanelOpen = options.keepPanelOpen ?? true;

  state.editingPinId = null;
  if (!preserveForm) {
    clearForm();
  }
  if (!keepPanelOpen) {
    setPanelOpen(false);
  }
  updatePlacementUi(message);
}

function focusPin(pinId, options = {}) {
  if (state.isFileProtocol || !markerRegistry.has(pinId)) return;
  state.activePinId = pinId;
  applyActiveMarkerState();

  const marker = markerRegistry.get(pinId);
  const zoom = options.zoom ?? Math.max(map.getZoom(), 5);
  map.flyTo(marker.getLatLng(), zoom, {
    animate: true,
    duration: 0.6,
  });

  if (options.openPopup) {
    marker.openPopup();
  }
}

function applyActiveMarkerState() {
  markerRegistry.forEach((marker, pinId) => {
    const element = marker.getElement();
    if (!element) return;
    element.classList.toggle("is-focused", pinId === state.activePinId);
  });
}

function updatePlacementUi(message) {
  const isEditing = Boolean(state.editingPinId);
  els.modeBadge.textContent = isEditing ? "Editing" : (state.placementArmed ? "Armed" : "Idle");
  els.formTitle.textContent = isEditing ? "Edit Review" : "Add Review";
  els.armPinButton.textContent = isEditing
    ? "Save Pin Changes"
    : (state.placementArmed ? "Cancel Pin Drop" : "Click Map To Drop Pin");
  els.armPinButton.disabled = !state.isAdmin;
  els.cancelEditButton.hidden = !isEditing;
  document.body.classList.toggle("is-placing-pin", state.placementArmed);
  document.body.classList.toggle("is-editing-pin", isEditing);
  if (message) {
    els.placementStatus.textContent = message;
  }
}

function updateAdminUi() {
  els.authButton.hidden = state.isAdmin;
  els.logoutButton.hidden = !state.isAdmin;
  els.adminPassword.disabled = state.isAdmin;
  els.adminPassword.placeholder = state.isAdmin ? "Admin unlocked" : "Enter admin password";

  if (state.isAdmin) {
    els.adminStatus.textContent = "Admin unlocked. Click a pin to edit it, or add a new one.";
  } else {
    els.adminStatus.textContent = "Public visitors can view pins, but only admins can add or edit them.";
  }

  updatePlacementUi();
}

function setPanelOpen(open) {
  state.panelOpen = open;
  els.controlPanel.classList.toggle("is-collapsed", !open);
  els.menuToggle.setAttribute("aria-expanded", String(open));
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
