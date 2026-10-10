/* =====================================================================
   DETROIT SITE EXPLORER — LAYER CONFIGURATION
   =====================================================================
   This is the ONLY file you need to edit to connect, replace or restyle
   a dataset. Every layer below is listed in the left sidebar.

   TO CONNECT A LAYER, fill in its "source" block:

     source: {
       type: "arcgis",            // "arcgis", "geojson" or "csv"
       url:  "https://.../FeatureServer/0",
       ...
     },
     visible: false, dataset:   "Exact dataset name as the publisher titles it",
     publisher: "Who publishes it (e.g. City of Detroit Open Data Portal)",
     retrieved: "2026-10-10",     // the date YOU pulled / connected it

   A layer whose url is empty ("") shows as "Not Connected" and its
   checkbox is disabled. Nothing is ever drawn for it.

   SOURCE TYPES
   - arcgis : an ArcGIS REST FeatureServer or MapServer layer URL
              (ends in /FeatureServer/0, /MapServer/3, etc.).
              loadMode "all"      = download the whole layer once
              loadMode "viewport" = only load what is on screen
                                    (use for big layers like parcels)
              where: optional SQL filter, e.g. "inventory_status = 'Vacant'"
   - geojson: a .geojson / .json file, either a web URL or a file in
              the data/ folder, e.g. "data/qct_2026.geojson"
   - csv    : a .csv file with latitude/longitude columns. Set
              latField and lngField to the column names.

   NOTE: Local files in data/ only load when the site is served by a
   web server (see README). ArcGIS URLs work even when you just
   double-click index.html.

   visible: true  = layer is switched on when the map opens (if connected)

   geometry: "point", "line" or "polygon" (controls the legend symbol
   and whether an opacity slider is shown).
   ===================================================================== */

window.MAP_CONFIG = {

  title: "Detroit Site Explorer",
  subtitle: "Corcoran Center Case Competition 2026 · GIS research map",

  map: {
    center: [42.3725, -83.1000],   // Detroit
    zoom: 12,
    minZoom: 9,
    maxZoom: 20
  },

  /* Official city limits. Everything outside them is covered on the base map
     ("Detroit only" checkbox in the top bar) and panning is kept near the city. */
  cityBoundary: {
    url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/City_of_Detroit_Boundary/FeatureServer/0",
    dataset: "City of Detroit Boundary", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
    maskColor: "#f8f9fb",   // color of the area outside Detroit
    maskOpacity: 1,         // 1 = completely hidden, 0.8 = faintly visible
    panPadding: 0.35        // how far past the city edge you can pan (fraction of city size)
  },

  /* Background maps. Esri tiles are used because they also work when
     index.html is opened by double-clicking (CARTO and OpenStreetMap tiles
     refuse requests that come from a local file). */
  basemaps: [
    {
      id: "gray", name: "Light gray (Esri)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      maxNativeZoom: 16,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community"
    },
    {
      id: "streets", name: "Streets (Esri)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      maxNativeZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors, and the GIS user community"
    },
    {
      id: "imagery", name: "Satellite (Esri World Imagery)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      maxNativeZoom: 19,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS user community"
    }
  ],

  // Straight-line distance rings drawn around a selected parcel.
  buffers: [
    { id: "q", label: "¼ mile", miles: 0.25 },
    { id: "h", label: "½ mile", miles: 0.5 },
    { id: "m", label: "1 mile", miles: 1.0 }
  ],
  defaultBuffer: "h",

  /* Property panel field lookup. For each item, the app uses the FIRST
     column name that exists in the clicked dataset (case-insensitive).
     A layer can list its own column names first with  fields: { address: ["name"] }.
     If none exist, the panel says "Not in connected data" — it never guesses. */
  propertyFields: {
    address:     ["address", "prop_address", "site_address", "street_address", "full_address"],
    parcelId:    ["parcel_id", "parcel_number", "parcelnum", "parcel_num", "parcelno"],
    lotSqft:     ["total_square_footage", "lot_sqft", "lot_size_sqft", "land_sqft"],
    lotAcres:    ["total_acreage", "acreage", "lot_acres"],
    owner:       ["taxpayer_1", "owner_name", "owner", "taxpayer"],
    dlbaStatus:  ["inventory_status_socrata", "inventory_status", "dlba_status"],
    zoning:      ["zoning_district", "zoning_rev", "zoning", "zone"],
    vacancy:     ["is_improved", "vacant", "is_vacant", "vacancy_status"],
    propClass:   ["property_class_description", "property_class_desc", "property_class"],
    landUse:     ["use_code_description", "land_use"],
    buildings:   ["num_buildings"],
    yearBuilt:   ["year_built"],
    taxStatus:   ["tax_status_description"],
    neighborhood:["neighborhood", "nhood_name"],
    district:    ["council_district"],
    tract:       ["census_tract_geoid_2020"],
    assessed:    ["amt_assessed_value", "assessed_value"],
    floodZone:   ["fema_flood_zone"]
  },

  /* Friendly labels for coded values (column -> value -> label). */
  valueLabels: {
    is_improved: {
      "0": "Not improved (Assessor: no buildings/improvements recorded)",
      "1": "Improved (Assessor: buildings/improvements recorded)"
    }
  },

  // Generic field candidates used to name features (each layer can set nameField first)
  nameFields: ["name", "facility_name", "store_name", "school_name", "park_name", "stop_name",
               "route_name", "site_name", "label", "title"],
  addressFields: ["address", "street_address", "addr", "full_address", "site_address"],

  /* ------------------------------------------------------------------
     ZONING CLASSIFICATIONS
     The actual district codes are read from the connected zoning
     dataset. Each code is placed in the first group whose pattern
     matches; anything unmatched goes to "Other / unclassified".
     Colors below are used for known Detroit Chapter 50 codes; any code
     not listed gets an automatic distinct color.
     ------------------------------------------------------------------ */
  zoning: {
    layerId: "zoning",
    fieldCandidates: ["zoning_rev", "zoning", "zone", "zoning_district", "zoning_class", "zonedist"],
    descriptionFields: ["zdescr_n", "zoning_description", "description"],
    groups: [
      { id: "res",  name: "Residential (R)",              pattern: "^R" },
      { id: "com",  name: "Commercial / Business (B)",    pattern: "^B" },
      { id: "mix",  name: "Mixed-use / Special Dev. (SD, MKT)", pattern: "^(SD|MKT)" },
      { id: "ind",  name: "Industrial (M, TM, W)",         pattern: "^(M\\d|TM|W)" },
      { id: "spc",  name: "Special-purpose (PD, PR, PC, P1…)", pattern: "^(PD|PR|PC|P\\d)" }
    ],
    otherGroupName: "Other / unclassified",
    colors: {
      R1: "#fff2a8", R2: "#ffe07a", R3: "#ffc857", R4: "#f9a03f", R5: "#e8772e", R6: "#c8553d",
      B1: "#f6b8b8", B2: "#ef8f8f", B3: "#e46767", B4: "#cf4444", B5: "#a92e2e", B6: "#7d1f1f",
      SD1: "#9adbd0", SD2: "#5fbfb2", SD3: "#3ea596", SD4: "#2a8a80", SD5: "#1d6862", MKT: "#4a9fd8",
      M1: "#ddd0f0", M2: "#bfa6e3", M3: "#9d7dd2", M4: "#7b58bd", M5: "#5a3c9e", TM: "#c6a0d6", W1: "#3f3480",
      PD: "#9fb7c4", PR: "#86c286", PC: "#8ea2b8", PCA: "#6b7f96", P1: "#b8b8b8"
    },
    fallbackPalette: ["#8dd3c7", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69",
                      "#fccde5", "#bc80bd", "#ccebc5", "#ffed6f", "#a6cee3", "#b2df8a"]
  },

  /* ------------------------------------------------------------------
     LAYER CATEGORIES
     role (used by the property panel):
       "property"    – clicking selects it as a candidate site
       "parcels"     – parcel polygons; also used to find the boundary
                       of a clicked DLBA point
       "zoning"      – zoning districts (looked up for the selected site)
       "financial"   – QCT / DDA / TMFHA (inside / outside test)
       "transit"     – listed under nearby transportation
       "amenity"     – listed under nearby amenities
       "environment" – on-site test + nearby list
       "context"     – shown on the map only
     Optional per-layer settings:
       fields: { address: ["name"] }   column names for the property panel
       nameField / addressField / typeField   columns used in pop-ups & lists
       colorBy: { field, rules: [{ match: "regex", color, label }], otherwise }
       note: shown in the layer's (i) box
     All sources below were checked on 2026-10-10 (field names, record
     counts, and that they load in a browser).
     ------------------------------------------------------------------ */
  categories: [

    {
      id: "property", name: "Property & Zoning", open: true,
      layers: [
        {
          id: "dlba", name: "DLBA-Owned Properties", role: "property", geometry: "point",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/DLBA_Owned_Properties/FeatureServer/0",
                    loadMode: "all", where: "1=1",
                    outFields: "name,parcel_id,inventory_status_socrata,neighborhood,council_district,block_range,ObjectId" },
          fields: { address: ["name"], dlbaStatus: ["inventory_status_socrata"] },
          nameField: "name", addressField: "name", typeField: "inventory_status_socrata",
          colorBy: { field: "inventory_status_socrata", rules: [
            { match: "Lot", color: "#0b6e4f", fillColor: "#18a978", label: "Lot (vacant land)" },
            { match: "Structure", color: "#9a3412", fillColor: "#f97316", label: "Structure" } ],
            otherwise: { color: "#475569", fillColor: "#94a3b8", label: "Other (e.g. Create-a-Project)" } },
          style: { color: "#0b6e4f", fillColor: "#18a978", radius: 3.5, weight: 0.8, fillOpacity: 0.85 },
          visible: false, dataset: "DLBA Owned Properties", publisher: "City of Detroit Open Data Portal (data.detroitmi.gov), source: Detroit Land Bank Authority", retrieved: "2026-10-10",
          note: "56,760 points (one per DLBA-owned property). Colored by DLBA Inventory Status: 'Lot' statuses vs 'Structure' statuses. Loads all points citywide (a few seconds, once). Click a point to match it to its Parcels (Current) boundary."
        },
        {
          id: "vacant", name: "Vacant Lots (Assessor: not improved)", role: "property", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
                    loadMode: "viewport", minZoom: 16, where: "is_improved = 0" },
          style: { color: "#a16207", fillColor: "#facc15", weight: 0.8, fillOpacity: 0.45 },
          visible: false, dataset: "Parcels (Current) — filtered to is_improved = 0", publisher: "City of Detroit Office of the Assessor", retrieved: "2026-10-10",
          note: "Every parcel (any owner) whose Assessor record shows no improvements — about 150,700 parcels citywide. This is the Assessor's flag, not a field survey."
        },
        {
          id: "vacantreg", name: "Vacant Property Registrations (BSEED)", role: "property", geometry: "point",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_vacant_property_registrations/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          typeField: "issued_date",
          style: { color: "#7c2d12", fillColor: "#fdba74", radius: 4, weight: 1.5, fillOpacity: 0.95 },
          visible: false, dataset: "Vacant Property Registrations", publisher: "City of Detroit BSEED (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "Properties whose owners registered them with BSEED as vacant (2019–present). These are mostly vacant buildings, not vacant land."
        },
        {
          id: "parcels", name: "Parcel Boundaries", role: "parcels", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
                    loadMode: "viewport", minZoom: 16, where: "1=1" },
          style: { color: "#4b5563", fillColor: "#ffffff", weight: 0.8, fillOpacity: 0.05 },
          visible: false, dataset: "Parcels (Current)", publisher: "City of Detroit Office of the Assessor (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "About 377,900 parcels with owner, lot size, zoning district, property class, assessed value, census tract and FEMA flood zone. Loads only for the area on screen at zoom 16+."
        },
        {
          id: "buildings", name: "Existing Building Footprints", role: "context", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Base_Units_Bulk_Export/FeatureServer/3",
                    loadMode: "viewport", minZoom: 17, where: "1=1" },
          nameField: "bldg_status", namePrefix: "Building — ",
          style: { color: "#3f3f46", fillColor: "#71717a", weight: 0.6, fillOpacity: 0.6 },
          visible: false, dataset: "Buildings (Base Units)", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "Building footprint polygons from the City's Base Units dataset (layer last edited 2025-04-22). Check satellite imagery for recent demolitions."
        },
        {
          id: "ownership", name: "Property Ownership (public owners)", role: "property", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
                    loadMode: "viewport", minZoom: 15,
                    where: "taxpayer_1 LIKE 'DETROIT LAND BAN%' OR taxpayer_1 LIKE 'CITY OF DETROIT%' OR taxpayer_1 LIKE 'MI LAND BANK%' OR taxpayer_1 LIKE 'WAYNE COUNTY LAND BANK%' OR taxpayer_1 LIKE 'STATE OF MICHIGAN%'" },
          colorBy: { field: "taxpayer_1", rules: [
            { match: "^DETROIT LAND BAN", color: "#065f46", fillColor: "#10b981", label: "Detroit Land Bank Authority" },
            { match: "^CITY OF DETROIT", color: "#1e3a8a", fillColor: "#60a5fa", label: "City of Detroit (incl. P&DD)" },
            { match: "LAND BANK", color: "#581c87", fillColor: "#c084fc", label: "Other land bank (State / Wayne County)" } ],
            otherwise: { color: "#78350f", fillColor: "#fbbf24", label: "State of Michigan" } },
          style: { color: "#334155", fillColor: "#94a3b8", weight: 0.8, fillOpacity: 0.5 },
          visible: false, dataset: "Parcels (Current) — public taxpayers only", publisher: "City of Detroit Office of the Assessor", retrieved: "2026-10-10",
          note: "About 65,800 parcels whose Assessor taxpayer starts with Detroit Land Bank (incl. misspellings), City of Detroit, MI Land Bank, Wayne County Land Bank, or State of Michigan. Useful for spotting adjacent City-owned parcels (case rule: City parcels < 25% of site area)."
        },
        {
          id: "zoning", name: "Zoning Districts", role: "zoning", geometry: "polygon", isZoning: true,
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Zoning_1/FeatureServer/0",
                    loadMode: "viewport", minZoom: 15, where: "1=1", displayOffset: 0.00001 },
          style: { color: "#525252", weight: 0.5, fillOpacity: 0.45 },
          visible: false, dataset: "Zoning (Chapter 50 districts)", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "28,316 polygons; loads for the area on screen at zoom 15+ (outlines lightly simplified for display only; site lookups use exact shapes). Uses the ZONING_REV code and ZDESCR_N description. Confirm by-right multifamily uses in Chapter 50 / the 2025 'Let's Build More Housing' amendment."
        },
        {
          id: "neighborhoods", name: "Neighborhood Boundaries", role: "context", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Current_City_of_Detroit_Neighborhoods/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "nhood_name",
          style: { color: "#111827", fillColor: "#111827", weight: 1.4, fillOpacity: 0.0, dashArray: "5 4" },
          visible: false, dataset: "Current City of Detroit Neighborhoods", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "205 neighborhood boundaries (outline only). Click inside a neighborhood away from parcels to see its name."
        }
      ]
    },

    {
      id: "financial", name: "Financial & Affordable Housing", open: false,
      layers: [
        {
          id: "qct", name: "Qualified Census Tracts (QCT) — 2026", role: "financial", geometry: "polygon",
          source: { type: "arcgis", url: "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QUALIFIED_CENSUS_TRACTS_2026/FeatureServer/0",
                    loadMode: "all", where: "STATE = '26' AND COUNTY = '163'" },
          nameField: "NAME",
          style: { color: "#1d4ed8", fillColor: "#3b82f6", weight: 1.2, fillOpacity: 0.2 },
          visible: false, dataset: "Qualified Census Tracts 2026", publisher: "HUD (HUD.Official.Content on ArcGIS Online)", retrieved: "2026-10-10",
          note: "HUD's 2026 QCT layer, filtered to Wayne County (state 26, county 163). Note: HUD's layer description text still says 2024, but the item is titled and published as the 2026 designations. Cross-check a final site on huduser.gov's QCT/DDA map, and check the 2027 maps (effective Jan 1, 2027)."
        },
        {
          id: "dda", name: "Difficult Development Areas (DDA) — 2026", role: "financial", geometry: "polygon",
          source: { type: "arcgis", url: "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0",
                    loadMode: "all", where: "DDA_CODE = 'METRO19820M19820'" },
          nameField: "ZCTA5", namePrefix: "ZIP ",
          style: { color: "#b45309", fillColor: "#f59e0b", weight: 1.5, fillOpacity: 0.25, dashArray: "6 4" },
          visible: false, dataset: "Difficult Development Areas 2026", publisher: "HUD (HUD.Official.Content on ArcGIS Online)", retrieved: "2026-10-10",
          note: "In metro areas HUD designates DDAs by ZIP code (Small Area DDAs). Filtered to the Detroit-Warren-Livonia HUD Metro FMR Area."
        },
        {
          id: "tmfha", name: "Targeted Multifamily Housing Areas (TMFHA)", role: "financial", geometry: "polygon",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/targeted_multifamily_areas/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "targeted_multifamily_area_id", namePrefix: "TMFHA area ",
          style: { color: "#7e22ce", fillColor: "#a855f7", weight: 1.8, fillOpacity: 0.2, dashArray: "2 4" },
          visible: false, dataset: "2024 Targeted Multifamily Areas", publisher: "City of Detroit Housing & Revitalization Department (ArcGIS Online)", retrieved: "2026-10-10",
          note: "The City's '2024 Targeted Multifamily Areas' layer (8 areas). The case requires new construction using HRD funds to be inside a TMFHA (HRD NOFA Appendix F) unless waived — compare against the NOFA map."
        }
      ]
    },

    {
      id: "transport", name: "Transportation & Accessibility", open: false,
      layers: [
        {
          id: "busroutes", name: "Bus Routes (DDOT)", role: "transit", geometry: "line",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/DDOT_Bus_Routes/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "route_name", typeField: "weekday_peak_frequency",
          style: { color: "#dc2626", weight: 2.5, opacity: 0.8 },
          visible: false, dataset: "DDOT Bus Routes", publisher: "Detroit Department of Transportation (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "82 route lines with frequencies and service days. SMART (suburban) routes are not included."
        },
        {
          id: "busstops", name: "Bus Stops (DDOT)", role: "transit", geometry: "point",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/DDOT_Bus_Stops/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "location", typeField: "route_name",
          style: { color: "#7f1d1d", fillColor: "#ffffff", radius: 3.5, weight: 1.5, fillOpacity: 1 },
          visible: false, dataset: "DDOT Bus Stops", publisher: "Detroit Department of Transportation (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "5,098 stops with routes served and shelter / bench information."
        },
        {
          id: "bikelanes", name: "Bicycle Lanes", role: "transit", geometry: "line",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bike_routes_and_facilities/FeatureServer/0",
                    loadMode: "all", where: "on_road_type IN ('Bike Lane', 'Buffered Bike Lane')" },
          nameField: "route_name", typeField: "on_road_type",
          style: { color: "#16a34a", weight: 2.5, opacity: 0.9 },
          visible: false, dataset: "Bike Lanes (bike routes and facilities) — on_road_type = Bike Lane / Buffered Bike Lane", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10"
        },
        {
          id: "protectedbike", name: "Protected Bicycle Lanes", role: "transit", geometry: "line",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bike_routes_and_facilities/FeatureServer/0",
                    loadMode: "all", where: "on_road_type = 'Protected Bike Lane'" },
          nameField: "route_name", typeField: "protected_bike_lane_type",
          style: { color: "#065f46", weight: 4, opacity: 0.95 },
          visible: false, dataset: "Bike Lanes (bike routes and facilities) — on_road_type = Protected Bike Lane", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10"
        },
        {
          id: "greenways", name: "Greenways", role: "transit", geometry: "line",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/gsd_city_of_detroit_greenways/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "greenway_name", typeField: "typology",
          style: { color: "#4d7c0f", weight: 4.5, opacity: 0.75, dashArray: "1 7", lineCap: "round" },
          visible: false, dataset: "City of Detroit Greenways", publisher: "City of Detroit General Services Department (ArcGIS Online)", retrieved: "2026-10-10",
          note: "Includes existing and planned greenway segments — check the 'tier' / 'typology' attributes in each pop-up."
        },
        {
          id: "pedpaths", name: "Shared-Use Paths (walking & biking)", role: "transit", geometry: "line",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bike_routes_and_facilities/FeatureServer/0",
                    loadMode: "all", where: "on_road_type = 'Shared-Use Paths'" },
          nameField: ["trail_name", "route_name"], typeField: "trail_type",
          style: { color: "#0891b2", weight: 2.5, opacity: 0.9, dashArray: "4 3" },
          visible: false, dataset: "Bike Lanes (bike routes and facilities) — on_road_type = Shared-Use Paths", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "Off-road paths shared by pedestrians and cyclists. No separate pedestrian-only path dataset was provided."
        },
        {
          id: "sidewalks", name: "Sidewalks", role: "context", geometry: "line",
          source: { type: "", url: "", loadMode: "viewport", minZoom: 16, where: "1=1" },
          style: { color: "#9ca3af", weight: 1.2, opacity: 0.9 },
          visible: false, dataset: "", publisher: "", retrieved: ""
        }
      ]
    },

    {
      id: "amenities", name: "Community Amenities", open: false,
      layers: [
        {
          id: "grocery", name: "Grocery Stores (SEMCOG)", role: "amenity", geometry: "point", icon: "grocery",
          source: { type: "arcgis", url: "https://gis.semcog.org/server/rest/services/Hosted/Grocery_Stores/FeatureServer/87",
                    loadMode: "all", where: "1=1" },
          nameField: "name",
          style: { color: "#ea580c" }, visible: false,
          dataset: "Grocery Stores (Southeast Michigan, 2024)", publisher: "SEMCOG", retrieved: "2026-10-10",
          note: "523 full-service grocery stores across Southeast Michigan, built by SEMCOG in 2024 from OpenStreetMap and reviewed for a full range of fresh food. Name only — no addresses."
        },
        {
          id: "schools", name: "Schools", role: "amenity", geometry: "point", icon: "school",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Primary_and_Secondary_Schools/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "ENTITY_NAME", addressField: "ADDRESS", typeField: "ENTITY_TYPE",
          style: { color: "#2563eb" }, visible: false,
          dataset: "Primary and Secondary Schools", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "203 open-active schools with grade levels and school type."
        },
        {
          id: "parks", name: "Parks", role: "amenity", geometry: "polygon", icon: "park",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/city_parks/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "park_name", addressField: "address", typeField: "park_type",
          style: { color: "#15803d", fillColor: "#4ade80", weight: 1, fillOpacity: 0.4 }, visible: false,
          dataset: "City Parks", publisher: "City of Detroit (data.detroitmi.gov)", retrieved: "2026-10-10",
          note: "302 City-owned parks. Distance is measured to the nearest park edge."
        },
        {
          id: "hospitals", name: "Hospitals", role: "amenity", geometry: "point", icon: "hospital",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Hospitals/FeatureServer/0",
                    loadMode: "all", where: "1=1" },
          nameField: "Name", addressField: "Address",
          style: { color: "#be123c" }, visible: false,
          dataset: "Hospitals", publisher: "City of Detroit (ArcGIS Online)", retrieved: "2026-10-10",
          note: "9 hospitals. This City layer was last edited in 2018, so verify that each hospital is still operating."
        },
        {
          id: "clinics", name: "Community Health Clinics (FQHCs)", role: "amenity", geometry: "point", icon: "clinic",
          source: { type: "arcgis", url: "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Federally_Qualified_Health_Centers/FeatureServer/0",
                    loadMode: "all", where: "1=1", coordsFromField: "Location_1" },
          nameField: "NAME", addressField: "Location_1",
          style: { color: "#db2777" }, visible: false,
          dataset: "Federally Qualified Health Centers", publisher: "City of Detroit (ArcGIS Online)", retrieved: "2026-10-10",
          note: "24 FQHC sites. This is a table: locations come from the '(lat, long)' text in the Location_1 column. No edit date is published, so verify that each clinic is current."
        }
      ]
    },

    {
      id: "environment", name: "Environmental Conditions", open: false,
      layers: [
        {
          id: "flood", name: "FEMA Flood Hazard Areas", role: "environment", geometry: "polygon",
          source: { type: "arcgis", url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
                    loadMode: "viewport", minZoom: 12,
                    where: "SFHA_TF = 'T' OR ZONE_SUBTY = '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'" },
          nameField: "FLD_ZONE", namePrefix: "Zone ", typeField: "ZONE_SUBTY",
          style: { color: "#0369a1", fillColor: "#38bdf8", weight: 1, fillOpacity: 0.35 },
          visible: false, dataset: "National Flood Hazard Layer (NFHL) — Flood Hazard Zones", publisher: "FEMA", retrieved: "2026-10-10",
          detailFields: ["FLD_ZONE", "ZONE_SUBTY"],
          note: "Shows Special Flood Hazard Areas (1% annual chance: zones A/AE/VE…) and 0.2% annual-chance areas. Loads for the area on screen at zoom 12+. The parcel's own 'FEMA Flood Zone' from the Assessor is also shown in the property panel."
        },
        {
          id: "brownfields", name: "Brownfield Sites", role: "environment", geometry: "point",
          source: { type: "", url: "", loadMode: "all", where: "1=1" },
          style: { color: "#713f12", fillColor: "#a16207", radius: 5, weight: 1.5, fillOpacity: 0.9 },
          visible: false, dataset: "", publisher: "", retrieved: ""
        },
        {
          id: "industrial", name: "Former Industrial Land Uses", role: "environment", geometry: "polygon",
          source: { type: "", url: "", loadMode: "all", where: "1=1" },
          style: { color: "#57534e", fillColor: "#a8a29e", weight: 1, fillOpacity: 0.4, dashArray: "3 3" },
          visible: false, dataset: "", publisher: "", retrieved: ""
        }
      ]
    }
  ]
};
