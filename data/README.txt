Put downloaded GIS files here (GeoJSON in latitude/longitude, or CSV with lat/long columns).

Then point a layer at the file in config/layers.js, for example:
  source: { type: "geojson", url: "data/qct_2026.geojson", loadMode: "all" }

Note: local files only load when the map is served by a web server (see README.md, section 1).
Record the dataset name and the date you downloaded it in the layer's "dataset" and "retrieved" fields.
