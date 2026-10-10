# Detroit Site Explorer

An interactive GIS map for exploring potential LIHTC development sites in Detroit for the
**2026 Corcoran Center Case Competition**. It is built with Leaflet, HTML, CSS and plain JavaScript.
There is no build step and nothing to install.

> **Status (2026-10-10):** 23 of 26 layers are connected to live, official data services
> (City of Detroit, HUD, SEMCOG and FEMA). Every service was checked in a browser for access,
> field names, record counts and paging. Sidewalks, Brownfield Sites and Former Industrial
> Land Uses are still **Not Connected** because no source has been chosen yet. The map never
> draws placeholder or invented data.

## Connected data sources (retrieved 2026-10-10)

| Layer | Dataset · publisher | Notes |
|---|---|---|
| DLBA-Owned Properties | DLBA Owned Properties · City of Detroit Open Data / DLBA | all 56,760 points load citywide (a few seconds), colored **lot** vs **structure** |
| Vacant Lots | Parcels (Current) where `is_improved = 0` · Assessor | ≈150,700 parcels with no recorded improvements (any owner) |
| Vacant Property Registrations | BSEED Vacant Property Registrations | 1,516 registered vacant properties (mostly buildings) |
| Parcel Boundaries | Parcels (Current) · Office of the Assessor | ≈377,900 parcels: owner, sq ft, zoning, class, tract, FEMA zone |
| Existing Building Footprints | Buildings (Base Units) · City of Detroit | last edited 2025-04-22 |
| Property Ownership | Parcels (Current), public taxpayers only | DLBA / City / other land banks / State, color-coded |
| Zoning Districts | Zoning (Chapter 50) · City of Detroit | 29 district codes with descriptions |
| Neighborhood Boundaries | Current City of Detroit Neighborhoods | 205 neighborhoods |
| QCT 2026 | Qualified Census Tracts 2026 · HUD | Wayne County tracts |
| DDA 2026 | Difficult Development Areas 2026 · HUD | Detroit-Warren-Livonia ZIP-based DDAs |
| TMFHA | 2024 Targeted Multifamily Areas · City of Detroit HRD | 8 areas |
| Bus Routes / Bus Stops | DDOT Bus Routes / DDOT Bus Stops | 82 routes, 5,098 stops |
| Bicycle Lanes / Protected / Shared-Use Paths | Bike Lanes (bike routes & facilities) · City of Detroit | split by `on_road_type` |
| Greenways | City of Detroit Greenways · GSD | existing and planned segments |
| Grocery Stores | Grocery Stores (SE Michigan, 2024) · SEMCOG | 523 stores |
| Schools | Primary and Secondary Schools · City of Detroit | 203 schools |
| Parks | City Parks · City of Detroit | 302 parks |
| Hospitals | Hospitals · City of Detroit | 9 hospitals, last edited 2018 |
| Community Health Clinics | Federally Qualified Health Centers · City of Detroit | 24 FQHCs, located from the "(lat, long)" text in the table |
| FEMA Flood Hazard Areas | National Flood Hazard Layer · FEMA | SFHA + 0.2% annual-chance areas |

Full URLs are in `config/layers.js` and in the app's **Data sources** window, which can be downloaded as CSV.

---

## 1. Opening the map

**Option A: double-click `index.html`.**
This works for any layer connected to an **ArcGIS REST URL**, which is how most City of Detroit,
HUD and FEMA data is published. The background maps come from Esri because Esri's tiles also work
from a double-clicked file. CARTO and OpenStreetMap tiles show "API key required" or get blocked that way.
You need an internet connection.

**Option B: run a small local web server.** You need this for files saved in `data/`
(GeoJSON or CSV), because browsers block web pages from reading local files directly.

- In **VS Code**, install the *Live Server* extension, right-click `index.html`, and choose *Open with Live Server*.
- If **Python** is installed, open a terminal in this folder and run `python -m http.server 8000`.
  Then go to <http://localhost:8000>.

**Option C: publish it online** so your team can open it from a link. For example, push the folder
to a GitHub repository and turn on GitHub Pages. Because the site is just static files, nothing
needs to change.

---

## 2. Using the map

| Area | What it does |
|---|---|
| **Left panel** | Five layer categories. Tick a box to show a layer. Polygon layers get an **Opacity** slider once they're on. The **i** button shows the dataset's source, retrieval date and status. The ☰ button hides the panel. |
| **Zoning Districts** | Once connected, lists every district code found in the data, grouped as Residential, Commercial, Mixed-use, Industrial, Special-purpose and Other. Each code has its own checkbox and color. Use *all* / *none* to toggle a whole group. |
| **Legend** | Bottom of the left panel. Shows only the layers that are switched on. |
| **Detroit only** | Checkbox in the top bar. Covers the base map outside the official City of Detroit Boundary, including the enclaves of Hamtramck and Highland Park. Data layers still draw on top, so a grocery store just over the city line stays visible. Untick it to see the surrounding area. |
| **Map** | Scroll to zoom, drag to pan (panning stays near Detroit). **⌂** or **Reset view** returns to all of Detroit. Large layers such as parcels only load once you zoom in, and a badge tells you the zoom level needed. |
| **Click a parcel** | Highlights it and fills in the **Property** tab on the right. |
| **Distance ring** | Off, ¼ mile, ½ mile or 1 mile, measured as a straight line from the site center (not walking distance). Nearby transit and amenities are listed within the ring. |
| **Shortlist tab** | **+ Add to shortlist** saves the selected site. Add notes, then **Export CSV / JSON** to share. **Import JSON** merges a teammate's list. The shortlist is saved in your browser only (there is no shared database). |
| **Search** | Searches address or parcel ID in the connected property layers. |
| **Data sources** | Table of every dataset with its URL, retrieval date and status. **Download source log (CSV)** helps with citations and the AI Log. |

### What the Property panel reports, and how

- **Property facts** (address, parcel ID, owner, DLBA status, zoning, vacancy and so on) come straight
  from the clicked dataset's columns. If none of the expected columns exist, the panel says
  *"Not in connected data"*. Hover a value to see which dataset and column it came from.
- **DLBA points → parcel boundary.** If you click a DLBA point and Parcel Boundaries is connected,
  the app finds the parcel polygon containing that point and uses its boundary and attributes.
- **Lot size** comes from the dataset's square-footage or acreage column. If neither exists, it is
  calculated from the mapped boundary and labeled *(approx.)*.
- **Financial overlays** (QCT, DDA, TMFHA) report *Inside*, *Partly inside* (the boundary crosses
  the site) or *Outside*. Always confirm against the official HUD or City source.
- **Environmental** reports whether any flood-hazard, brownfield or former-industrial feature touches
  the site. *"Not mapped on site" does not mean the site is clean.*

---

## 3. Connecting a dataset

Everything is set in **`config/layers.js`**. Find the layer and fill in its `source` and citation fields:

```js
{
  id: "qct", name: "Qualified Census Tracts (QCT) — 2026", role: "financial", geometry: "polygon",
  source: { type: "arcgis", url: "https://services.arcgis.com/…/FeatureServer/0", loadMode: "all", where: "1=1" },
  style: { color: "#1d4ed8", fillColor: "#3b82f6", weight: 1.5, fillOpacity: 0.22 },
  visible: false,
  dataset: "HUD 2026 Qualified Census Tracts",
  publisher: "HUD USER / HUD eGIS",
  retrieved: "2026-10-10"          // ← the date you pulled it
}
```

### Source types

| `type` | `url` example | Notes |
|---|---|---|
| `arcgis` | `https://…/FeatureServer/0` or `…/MapServer/3` | Best for live City data. If you paste a link ending in `/FeatureServer`, layer `/0` is used. |
| `geojson` | `data/qct_2026.geojson` or a web URL | Must be in latitude/longitude (EPSG:4326). The app refuses projected coordinates instead of drawing them in the wrong place. |
| `csv` | `data/grocery.csv` | Points only. Add `latField: "Latitude", lngField: "Longitude"` if the columns aren't detected automatically. |

### Other options in `source`

- `loadMode: "all"` downloads the whole layer once. Use it for overlays, transit and amenities.
- `loadMode: "viewport"` with `minZoom: 16` loads only the visible area. It is used for the big layers:
  Parcels (zoom 16+), Zoning (zoom 15+) and FEMA flood zones (zoom 12+). If a layer says **Zoom in**,
  zoom closer. The message at the bottom of the map gives the level needed.
- `where: "inventory_status = 'Vacant Land'"` is an SQL filter for ArcGIS layers. It lets you build
  *Vacant Lots* from the DLBA layer, for example.
- `visible: true` switches the layer on when the map opens.

### Finding the ArcGIS URL on the Detroit Open Data Portal

On a dataset page at data.detroitmi.gov, open **I want to use this → View API resources**
(or *APIs*). Copy the **GeoService / FeatureServer** URL. It ends in `/FeatureServer/0`.

### Per-layer options

`fields`, `nameField`, `addressField` and `typeField` name the columns for the property panel and
pop-ups. For example, the DLBA layer stores its address in a column called `name`. `colorBy` colors
features by a column's value, which is how DLBA lots and structures are told apart. `note` is shown
in the layer's **i** box.

### Column names

If the Property panel shows *"Not in connected data"* for something the dataset does contain,
add that column name to the matching list in `propertyFields` near the top of `config/layers.js`.
Zoning works the same way: add the zoning column to `zoning.fieldCandidates`.

---

## 4. Files

```
index.html          page structure
style.css           look and layout
script.js           map logic: loading, layers, selection, analysis, shortlist
config/layers.js    ← edit this: layers, sources, colors, visibility, field names
data/               put downloaded GeoJSON / CSV files here
lib/leaflet/        Leaflet 1.9.4 (included, so the app works offline)
```

## 5. Planned later (not built yet)

The code has marked *EXTENSION POINT*s for these:

- Automatically finding adjacent DLBA parcels for assemblages
- Filters for multifamily zoning eligibility and minimum/maximum parcel size
- Site suitability scoring and rankings
- Side-by-side comparison of several properties
- Exportable site-analysis reports

## 6. Ground rules this map follows

- It only uses real, connected geographic data. Nothing is invented or shown as a placeholder.
- It records each dataset's source and retrieval date (see **Data sources**).
- It does not score or rank sites automatically. The team makes those judgments.
