const API_BASE_URL = "http://127.0.0.1:8000";
const FIRMS_DAY_RANGE = 5; // NASA FIRMS Area API supports [1..5] days

let spatialMap, currentBasemapLayer;
let searchMarker = null;
let searchDebounceTimer = null;

const basemaps = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

const focusRegions = {
    kalbar:      { center: [-0.4500, 110.6000], zoom: 8,  label: 'Provinsi Kalimantan Barat' },
    bengkayang:  { center: [1.0250, 109.4083],  zoom: 12, label: 'Kabupaten Bengkayang' },
    kapuashulu:  { center: [-0.4500, 112.7500], zoom: 12, label: 'Kabupaten Kapuas Hulu' },
    kayongutara: { center: [-1.2472, 109.5458], zoom: 12, label: 'Kabupaten Kayong Utara' },
    ketapang:    { center: [-1.7000, 109.9833], zoom: 12, label: 'Kabupaten Ketapang' },
    kuburaya:    { center: [-0.6214, 109.5076], zoom: 12, label: 'Kabupaten Kubu Raya' },
    landak:      { center: [0.0667, 109.6725],  zoom: 12, label: 'Kabupaten Landak' },
    melawi:      { center: [-0.8150, 111.8000], zoom: 12, label: 'Kabupaten Melawi' },
    mempawah:    { center: [0.3633, 108.8792],  zoom: 12, label: 'Kabupaten Mempawah' },
    sambas:      { center: [1.3417, 109.3583],  zoom: 12, label: 'Kabupaten Sambas' },
    sanggau:     { center: [0.4500, 110.0917],  zoom: 12, label: 'Kabupaten Sanggau' },
    sekadau:     { center: [-0.0503, 110.9238], zoom: 12, label: 'Kabupaten Sekadau' },
    sintang:     { center: [0.1583, 112.0833],  zoom: 12, label: 'Kabupaten Sintang' },
    pontianak:   { center: [-0.0268, 109.3286], zoom: 12, label: 'Kota Pontianak' },
    singkawang:  { center: [0.8815, 109.0164],  zoom: 12, label: 'Kota Singkawang' }
};

// Dummy Fire Hotspot GeoJSON across West Kalimantan for visual demonstration
const DUMMY_HOTSPOTS_GEOJSON = {
    type: "FeatureCollection",
    features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [110.1245, -1.7820] }, properties: { lokasi: "Kec. Matan Hilir Selatan, Kab. Ketapang", confidence: "high", frp: 42.8, lahan: "Gambut Dalam", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [110.2890, -1.6150] }, properties: { lokasi: "Kec. Delta Pawan, Kab. Ketapang", confidence: "nominal", frp: 19.4, lahan: "Semak Belukar", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [110.6412, -2.1430] }, properties: { lokasi: "Kec. Kendawangan, Kab. Ketapang", confidence: "high", frp: 56.1, lahan: "Lahan Gambut", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.4820, -0.5890] }, properties: { lokasi: "Kec. Rasau Jaya, Kab. Kubu Raya", confidence: "high", frp: 38.5, lahan: "Gambut Terdegradasi", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.3910, -0.4420] }, properties: { lokasi: "Kec. Sungai Raya, Kab. Kubu Raya", confidence: "nominal", frp: 15.2, lahan: "Perkebunan", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.6125, -0.7510] }, properties: { lokasi: "Kec. Terentang, Kab. Kubu Raya", confidence: "high", frp: 47.0, lahan: "Gambut Dalam", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.5910, -1.1980] }, properties: { lokasi: "Kec. Sukadana, Kab. Kayong Utara", confidence: "high", frp: 33.9, lahan: "Penyangga Taman Nasional", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.3420, 1.3850] }, properties: { lokasi: "Kec. Tebas, Kab. Sambas", confidence: "nominal", frp: 14.7, lahan: "Lahan Terbuka", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.4510, 1.0420] }, properties: { lokasi: "Kec. Bengkayang, Kab. Bengkayang", confidence: "low", frp: 8.6, lahan: "Pertanian Lahan Kering", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [108.9210, 0.3820] }, properties: { lokasi: "Kec. Mempawah Hilir, Kab. Mempawah", confidence: "nominal", frp: 21.3, lahan: "Lahan Gambut", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.7120, 0.0950] }, properties: { lokasi: "Kec. Ngabang, Kab. Landak", confidence: "nominal", frp: 17.8, lahan: "Semak Belukar", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [110.1450, 0.4120] }, properties: { lokasi: "Kec. Kapuas, Kab. Sanggau", confidence: "high", frp: 29.4, lahan: "Perkebunan", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [110.9050, -0.0410] }, properties: { lokasi: "Kec. Sekadau Hilir, Kab. Sekadau", confidence: "nominal", frp: 16.5, lahan: "Semak Belukar", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [111.4920, 0.0720] }, properties: { lokasi: "Kec. Sintang, Kab. Sintang", confidence: "high", frp: 35.2, lahan: "Lahan Gambut", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [111.7850, -0.7920] }, properties: { lokasi: "Kec. Nanga Pinoh, Kab. Melawi", confidence: "nominal", frp: 18.9, lahan: "Hutan Sekunder", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [112.6810, 0.8420] }, properties: { lokasi: "Kec. Batang Lupar, Kab. Kapuas Hulu", confidence: "high", frp: 44.6, lahan: "Rawa Gambut Danau Sentarum", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [112.9210, 0.6540] }, properties: { lokasi: "Kec. Putussibau Utara, Kab. Kapuas Hulu", confidence: "nominal", frp: 22.1, lahan: "Hutan Sekunder", tanggal: "Simulasi Demo" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [109.0450, 0.8710] }, properties: { lokasi: "Kec. Singkawang Selatan, Kota Singkawang", confidence: "low", frp: 9.8, lahan: "Semak Belukar", tanggal: "Simulasi Demo" } }
    ]
};

const parameterLayers = {
    sebaran_gambut: null,
    tutupan_lahan: null,
    ndmi: null,
    ndvi: null,
    nbr: null,
    permukiman: null,
    jaringan_jalan: null,
    temperatur: null,
    badan_air: null,
    slope: null,
    elevasi: null,
    bahaya_karhutla: null,
    hotspot: null,
    hotspot_dummy: null,
    safety_map: null
};

const layerStates = {};

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.className = savedTheme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';

    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const target = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', target);
            localStorage.setItem('theme', target);
            const themeIcon = document.getElementById('themeIcon');
            if (themeIcon) themeIcon.className = target === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
        });
    }

    document.querySelectorAll('.param-item-card').forEach(card => {
        const layerKey = card.getAttribute('data-layer');
        const initYear = card.getAttribute('data-year');
        const initOpacity = parseInt(card.getAttribute('data-opacity'), 10);
        layerStates[layerKey] = { year: initYear, opacity: initOpacity / 100 };

        card.querySelectorAll('input[type="range"].mini-range').forEach(slider => {
            updateTooltipPosition(slider);
            slider.addEventListener('mousedown', () => slider.parentElement.classList.add('dragging'));
            slider.addEventListener('touchstart', () => slider.parentElement.classList.add('dragging'));
        });
    });

    window.addEventListener('mouseup', () => {
        document.querySelectorAll('.slider-track-wrap.dragging').forEach(el => el.classList.remove('dragging'));
    });
    window.addEventListener('touchend', () => {
        document.querySelectorAll('.slider-track-wrap.dragging').forEach(el => el.classList.remove('dragging'));
    });

    spatialMap = L.map('spatialMap', {
        center: focusRegions.kalbar.center,
        zoom: focusRegions.kalbar.zoom,
        zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(spatialMap);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(spatialMap);

    currentBasemapLayer = L.tileLayer(basemaps.satellite, {
        maxZoom: 19,
        attribution: 'Esri World Imagery | <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a>'
    }).addTo(spatialMap);

    spatialMap.on('mousemove', (e) => {
        document.getElementById('coordTrackerText').innerText =
            `Lat: ${e.latlng.lat.toFixed(5)} | Lng: ${e.latlng.lng.toFixed(5)}`;
    });

    // Load default checked layers (e.g., bahaya_karhutla)
    document.querySelectorAll('.param-item-card input[type="checkbox"]:checked').forEach(cb => {
        const card = cb.closest('.param-item-card');
        const key = card && card.getAttribute('data-layer');
        if (key) toggleParameterLayer(key, cb);
    });

    const sidebar = document.getElementById('spatialSidebar');
    const resizer = document.getElementById('sidebarResizer');

    if (sidebar && resizer) {
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('resizing');
            sidebar.style.transition = 'none';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const sidebarRect = sidebar.getBoundingClientRect();
            const newWidth = e.clientX - sidebarRect.left;

            if (newWidth >= 280 && newWidth <= 650) {
                sidebar.style.width = `${newWidth}px`;
                if (spatialMap && spatialMap.invalidateSize) {
                    spatialMap.invalidateSize();
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                sidebar.style.transition = '';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                if (spatialMap && spatialMap.invalidateSize) {
                    spatialMap.invalidateSize();
                }
            }
        });
    }
});

function updateTooltipPosition(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    const tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (tooltip) {
        const clampedPct = Math.min(Math.max(pct, 10), 90);
        tooltip.style.left = `${clampedPct}%`;
    }
}

function buildRasterTileLayer(layerKey, year, opacity) {
    const query = year && !["RBI 50K", "SRTM 30m"].includes(year)
        ? `?year=${encodeURIComponent(year)}`
        : "";
    const url = `${API_BASE_URL}/api/tiles/${layerKey}/{z}/{x}/{y}.png${query}`;
    return L.tileLayer(url, {
        opacity: opacity,
        maxZoom: 19,
        zIndex: layerKey === 'bahaya_karhutla' ? 250 : 200
    });
}

async function fetchFirmsHotspotLayer(opacity) {
    const url = `${API_BASE_URL}/api/firms/hotspots?day_range=${FIRMS_DAY_RANGE}`;
    const response = await fetch(url);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Gagal memuat data FIRMS (HTTP ${response.status})`);
    }
    const geojson = await response.json();
    const features = Array.isArray(geojson.features) ? geojson.features : [];

    const layerGroup = L.geoJSON(
        { type: "FeatureCollection", features },
        {
            pointToLayer: (feature, latlng) => {
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: "#ef4444",
                    color: "#7f1d1d",
                    weight: 1.5,
                    opacity: opacity,
                    fillOpacity: Math.min(0.92, opacity)
                });
            },
            onEachFeature: (feature, layer) => {
                const p = feature.properties || {};
                layer.bindPopup(
                    `<strong>Titik Panas FIRMS (NRT ${FIRMS_DAY_RANGE} Hari)</strong><br>` +
                    `Tanggal: ${p.acq_date || "-"} ${p.acq_time || ""}<br>` +
                    `Satelit: ${p.satellite || "-"} (${p.instrument || "-"})<br>` +
                    `Confidence: ${p.confidence || "-"} | FRP: ${p.frp || "-"} MW`
                );
            }
        }
    );

    return { layerGroup, count: features.length };
}

function buildDummyHotspotLayer(opacity) {
    return L.geoJSON(DUMMY_HOTSPOTS_GEOJSON, {
        pointToLayer: (feature, latlng) => {
            const conf = (feature.properties && feature.properties.confidence) || "nominal";
            const fillColor = conf === "high" ? "#dc2626" : conf === "nominal" ? "#f97316" : "#eab308";
            return L.circleMarker(latlng, {
                radius: 7,
                fillColor: fillColor,
                color: "#ffffff",
                weight: 1.5,
                opacity: opacity,
                fillOpacity: Math.min(0.92, opacity)
            });
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            const [lng, lat] = feature.geometry.coordinates;
            layer.bindPopup(
                `<strong>Simulasi Titik Panas (Dummy)</strong><br>` +
                `Lokasi: ${p.lokasi || "-"}<br>` +
                `Koordinat: ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>` +
                `Tutupan/Lahan: ${p.lahan || "-"}<br>` +
                `Confidence: ${(p.confidence || "-").toUpperCase()} | FRP: ${p.frp || "-"} MW`
            );
        }
    });
}

async function selectParamYear(btn, layerKey, yearVal) {
    const card = btn.closest('.param-item-card');
    card.setAttribute('data-year', yearVal);
    layerStates[layerKey].year = yearVal;

    card.querySelectorAll('.year-chip').forEach(chip => chip.classList.remove('active'));
    btn.classList.add('active');

    const checkbox = card.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;

    if (parameterLayers[layerKey] && spatialMap.hasLayer(parameterLayers[layerKey])) {
        spatialMap.removeLayer(parameterLayers[layerKey]);
    }
    parameterLayers[layerKey] = buildRasterTileLayer(layerKey, yearVal, layerStates[layerKey].opacity);
    parameterLayers[layerKey].addTo(spatialMap);
    showToast(`Memuat ${layerKey.toUpperCase()} Tahun ${yearVal} (Opacity ${Math.round(layerStates[layerKey].opacity * 100)}%)`);
}

function handleParamOpacity(slider, layerKey) {
    const opacityVal = parseInt(slider.value, 10);
    const card = slider.closest('.param-item-card');
    card.setAttribute('data-opacity', opacityVal);
    layerStates[layerKey].opacity = opacityVal / 100;

    const tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (tooltip) tooltip.innerText = `${opacityVal}`;

    updateTooltipPosition(slider);

    const layer = parameterLayers[layerKey];
    const op = layerStates[layerKey].opacity;
    if (layer && spatialMap && spatialMap.hasLayer(layer)) {
        if (typeof layer.setOpacity === 'function') {
            layer.setOpacity(op);
        } else if (typeof layer.setStyle === 'function') {
            layer.setStyle({ opacity: op, fillOpacity: Math.min(0.92, op) });
        }
    }
}

function zoomToRegion(regionKey, resetSelect = false) {
    if (!regionKey) return;

    if (resetSelect) {
        const selectEl = document.getElementById('kabKotaSelect');
        if (selectEl) selectEl.selectedIndex = 0;
    }

    const target = focusRegions[regionKey];
    if (target && spatialMap) {
        spatialMap.flyTo(target.center, target.zoom, { duration: 1.2 });
        showToast(`Fokus Peta: ${target.label}`);
    }
}

function setBasemap(type, btn) {
    document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentBasemapLayer) spatialMap.removeLayer(currentBasemapLayer);
    currentBasemapLayer = L.tileLayer(basemaps[type], { maxZoom: 19 }).addTo(spatialMap);
}

function toggleParamGroup(groupId, btnElement) {
    const content = document.getElementById(groupId);
    const icon = btnElement.querySelector('i');
    const isCurrentlyOpen = content.classList.contains('active');

    if (isCurrentlyOpen) {
        content.classList.remove('active');
        btnElement.classList.remove('is-open');
        icon.className = 'ph ph-caret-down';
    } else {
        content.classList.add('active');
        btnElement.classList.add('is-open');
        icon.className = 'ph ph-caret-up';
    }
}

async function toggleParameterLayer(layerKey, checkboxEl) {
    const isChecked = checkboxEl.checked;
    const card = checkboxEl.closest('.param-item-card');
    const dataType = card ? card.getAttribute('data-type') : 'multi';

    if (dataType === 'static' && card) {
        const staticPill = card.querySelector('.static-year-pill');
        if (staticPill) {
            staticPill.classList.toggle('is-active', isChecked);
        }
    }

    const state = layerStates[layerKey] || { year: '2025', opacity: 0.8 };

    if (!isChecked) {
        if (parameterLayers[layerKey] && spatialMap && spatialMap.hasLayer(parameterLayers[layerKey])) {
            spatialMap.removeLayer(parameterLayers[layerKey]);
        }
        return;
    }

    if (layerKey === 'hotspot') {
        showToast(`Mengambil titik panas FIRMS (${FIRMS_DAY_RANGE} hari terakhir)...`);
        try {
            if (parameterLayers.hotspot && spatialMap.hasLayer(parameterLayers.hotspot)) {
                spatialMap.removeLayer(parameterLayers.hotspot);
            }
            const { layerGroup, count } = await fetchFirmsHotspotLayer(state.opacity);
            parameterLayers.hotspot = layerGroup;
            layerGroup.addTo(spatialMap);
            showToast(`Titik Panas FIRMS (${FIRMS_DAY_RANGE} hari): ${count} titik ditemukan.`);
        } catch (err) {
            checkboxEl.checked = false;
            if (dataType === 'static' && card) {
                const staticPill = card.querySelector('.static-year-pill');
                if (staticPill) staticPill.classList.remove('is-active');
            }
            showToast(err.message);
        }
        return;
    }

    if (layerKey === 'hotspot_dummy') {
        if (parameterLayers.hotspot_dummy && spatialMap.hasLayer(parameterLayers.hotspot_dummy)) {
            spatialMap.removeLayer(parameterLayers.hotspot_dummy);
        }
        parameterLayers.hotspot_dummy = buildDummyHotspotLayer(state.opacity);
        parameterLayers.hotspot_dummy.addTo(spatialMap);
        showToast(`Simulasi Hotspot aktif (${DUMMY_HOTSPOTS_GEOJSON.features.length} titik dummy).`);
        return;
    }

    if (parameterLayers[layerKey] && spatialMap.hasLayer(parameterLayers[layerKey])) {
        spatialMap.removeLayer(parameterLayers[layerKey]);
    }
    const rasterLayer = buildRasterTileLayer(layerKey, state.year, state.opacity);
    parameterLayers[layerKey] = rasterLayer;
    rasterLayer.addTo(spatialMap);
    showToast(`Layer "${layerKey.replace(/_/g, ' ').toUpperCase()}" (${state.year}, Opacity ${Math.round(state.opacity * 100)}%) aktif.`);
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function handleSearchInput(val) {
    const query = val.trim();
    const resultsBox = document.getElementById('locationSearchResults');
    clearTimeout(searchDebounceTimer);

    if (query === '') {
        if (resultsBox) resultsBox.classList.remove('open');
        if (searchMarker && spatialMap) {
            spatialMap.removeLayer(searchMarker);
            searchMarker = null;
        }
        return;
    }

    if (query.length >= 2) {
        searchDebounceTimer = setTimeout(() => {
            searchMapLocation();
        }, 350);
    }
}

async function searchMapLocation() {
    const query = document.getElementById('locationSearchInput').value.trim();
    const resultsBox = document.getElementById('locationSearchResults');
    if (!query) return;

    resultsBox.innerHTML = '<div class="search-result-item">Mencari lokasi...</div>';
    resultsBox.classList.add('open');

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&viewbox=108.5,2.2,114.3,-3.2&q=${encodeURIComponent(query)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data || data.length === 0) {
            resultsBox.innerHTML = '<div class="search-result-item">Lokasi tidak ditemukan.</div>';
            return;
        }

        resultsBox.innerHTML = data.map((item) => `
            <div class="search-result-item" onclick="selectSearchLocation(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')">
                ${item.display_name}
            </div>
        `).join('');
    } catch (err) {
        resultsBox.innerHTML = '<div class="search-result-item">Gagal memuat pencarian.</div>';
    }
}

function selectSearchLocation(lat, lon, label) {
    const resultsBox = document.getElementById('locationSearchResults');
    const searchInput = document.getElementById('locationSearchInput');

    if (resultsBox) resultsBox.classList.remove('open');
    if (searchInput) searchInput.value = '';

    const coords = [parseFloat(lat), parseFloat(lon)];
    spatialMap.flyTo(coords, 12, { duration: 1.2 });

    if (searchMarker) {
        spatialMap.removeLayer(searchMarker);
    }

    searchMarker = L.marker(coords).addTo(spatialMap)
        .bindPopup(`<strong>Lokasi Ditemukan:</strong><br>${label}`)
        .openPopup()
        .on('popupclose', () => {
            if (searchMarker) {
                spatialMap.removeLayer(searchMarker);
                searchMarker = null;
            }
        });
}

document.addEventListener('click', (e) => {
    const box = document.querySelector('.map-search-box');
    const resultsBox = document.getElementById('locationSearchResults');
    if (box && resultsBox && !box.contains(e.target)) {
        resultsBox.classList.remove('open');
    }
});

function openHazardModal() {
    const modal = document.getElementById('hazardModalOverlay');
    if (modal) modal.classList.add('open');
}

function closeHazardModal() {
    const modal = document.getElementById('hazardModalOverlay');
    if (modal) modal.classList.remove('open');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHazardModal();
    }
});