/**
 * The data the Living Earth streams (M0–M1), with the licence and attribution each one demands.
 *
 * Every source declares its attribution here (the "tileset manifest" of docs/earth-sim/10 §2.5 in its
 * simplest form); the attribution strip shows the sources whose tiles are on screen, the model card
 * lists all of them. The URLs are the providers' public endpoints for this work-in-progress stage – the
 * pipeline (docs/earth-sim/11) mirrors them onto the mittwald server before the sim leaves `hidden`.
 */

export const TERRAIN = Object.freeze({
  id: 'mapterhorn',
  url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  tileDimension: 512,
  // global coverage ends at z12 (≈ 19 m per pixel at 52° N); the national 1 m / 0.4 m models of NRW and
  // Denmark reach z16/z17 inside their regions – read to z16 (≈ 0.7 m per pixel) inside the hero boxes
  // only (regions.js caps every other place at z12)
  maxZoom: 16,
  encoding: 'terrarium',
  name: 'Mapterhorn',
  provenance: 'measured',
  licence: 'per source (Mapterhorn attribution list)',
  attribution: '© Mapterhorn',
  href: 'https://mapterhorn.com/attribution',
  // conditions, not courtesy: the sources Mapterhorn fuses that matter for this sim
  notices: [
    'Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    'DGM1 NRW: Ministerium des Innern des Landes Nordrhein-Westfalen, dl-de/zero-2.0',
    'Danmarks Højdemodel – Terræn: Klimadatastyrelsen, CC BY 4.0',
  ],
});

export const IMAGERY = Object.freeze({
  id: 'eox-s2cloudless-2025',
  url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
  tileDimension: 256,
  levels: 16, // z0–z15: Sentinel-2's 10 m pixels are native at z14 (≈ 6 m per pixel at 52° N)
  name: 'EOX Sentinel-2 cloudless 2025',
  provenance: 'measured',
  licence: 'CC BY-NC-SA 4.0',
  attribution: 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
  // the strip keeps the full credit – CC BY-NC-SA asks for it where the imagery is shown
  href: 'https://cloudless.eox.at',
});

export const IMAGERY_NRW = Object.freeze({
  id: 'geobasis-nrw-dop',
  // WMTS tile matrix set EPSG_3857_16: matrix m = Web-Mercator zoom − 5, down to 7.5 cm per pixel (z21)
  url: 'https://www.wmts.nrw.de/geobasis/wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{m}/{x}/{y}',
  levels: 22,
  name: 'Geobasis NRW digital orthophotos (DOP10, 2024)',
  provenance: 'measured',
  licence: 'dl-de/zero-2.0',
  attribution: '© Geobasis NRW (DOP, dl-de/zero-2.0)',
  short: '© Geobasis NRW',
  href: 'https://www.bezreg-koeln.nrw.de/geobasis-nrw/produkte-und-dienste/luftbild-und-satellitenbildinformationen/aktuelle-luftbild-und-0',
  notices: ['Lübbecke: the south part (town, ridge) was flown leaf-off on 8 Mar 2024, the north part leaf-on on 1 May 2024 – the seam shows near 52.31° N.'],
});

export const BUILDINGS_NRW = Object.freeze({
  id: 'geobasis-nrw-lod2',
  url: 'https://ogc-api.nrw.de/3dg/v1/collections/building/3dtiles',
  name: 'Geobasis NRW 3D building models LoD2 (3D Tiles 1.1)',
  provenance: 'measured',
  licence: 'dl-de/zero-2.0',
  attribution: '© Geobasis NRW (LoD2, dl-de/zero-2.0)',
  short: '© Geobasis NRW LoD2',
  href: 'https://ogc-api.nrw.de/3dg/v1',
  notices: ['Roof shapes fitted to the 2023 laser scan (±1 m); untextured – wall and roof colours are generated from the building function.'],
});

export const BUILDINGS_OSM = Object.freeze({
  id: 'osm-buildings',
  file: 'earth/fanoe-buildings.bin.gz',
  name: 'OpenStreetMap building footprints (Fanø), baked 31 Oct 2026',
  provenance: 'generated',
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors (ODbL)',
  short: '© OpenStreetMap contributors',
  href: 'https://www.openstreetmap.org/copyright',
  notices: ['Footprints measured by mappers; heights and roofs are generated from the tags or typical values until the LoD2 reconstruction from the Danish point cloud exists. The baked footprint file is a derived database under ODbL.'],
});

export const TREES_NRW = Object.freeze({
  id: 'geobasis-nrw-trees',
  name: 'Trees from Geobasis NRW: normalised surface model (nDOM) and leaf-off colour-infrared orthophoto (iDOP 2025)',
  provenance: 'measured',
  licence: 'dl-de/zero-2.0',
  attribution: '© Geobasis NRW (nDOM, iDOP, dl-de/zero-2.0); single trees detected in the browser',
  short: '© Geobasis NRW nDOM',
  href: 'https://www.wcs.nrw.de/geobasis/wcs_nw_ndom',
  notices: ['Tree positions, heights and crown widths come from the canopy height model; the species group (conifer/broadleaf) from the March 2025 colour-infrared photos; the tree shapes are generated.'],
});

export const TIDES_DMI = Object.freeze({
  id: 'dmi-ocean',
  name: 'DMI open ocean data: Esbjerg gauges (since 2001) and tide predictions for Nordby',
  provenance: 'measured',
  licence: 'CC BY 4.0',
  attribution: 'Water level: Danmarks Meteorologiske Institut (DMI), open data, CC BY 4.0',
  short: 'DMI water level',
  href: 'https://opendatadocs.dmi.govcloud.dk/en/APIs/Oceanographic_Observation_API',
  notices: ['Where neither gauge nor prediction covers the instant, a harmonic model fitted to DMI\'s predictions answers (37 constituents, high and low waters within 9 cm and mostly within 10 minutes of DMI\'s).'],
});

export const BATHYMETRY_EU = Object.freeze({
  id: 'emodnet-bathymetry',
  name: 'EMODnet Bathymetry DTM (1/16′, European seas, with intertidal flats)',
  provenance: 'measured',
  licence: 'CC BY 4.0',
  attribution: 'EMODnet Bathymetry Consortium (2024): EMODnet Digital Bathymetry (DTM)',
  short: 'EMODnet Bathymetry',
  href: 'https://emodnet.ec.europa.eu/en/bathymetry',
});

export const HERO_HEIGHTS = Object.freeze({
  id: 'national-geoids',
  name: 'National height references: GCG2016 (Germany), DVR90(2023) (Denmark)',
  provenance: 'measured',
  licence: 'CC BY 4.0',
  attribution: 'GCG2016 © BKG (2023) CC BY 4.0; DVR90(2023) © Klimadatastyrelsen CC BY 4.0; via the PROJ data CDN',
  href: 'https://cdn.proj.org',
});

export const BATHYMETRY = Object.freeze({
  id: 'gebco-2026',
  // the cloud-optimised GeoTIFF on Source Cooperative (15″ grid + 7 overviews, CORS and byte ranges)
  url: 'https://data.source.coop/ausantarctic/gebco/GEBCO_2026.tif',
  name: 'GEBCO_2026 Grid',
  provenance: 'measured',
  licence: 'public domain (GEBCO terms: acknowledge the source)',
  attribution: 'GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa)',
  short: 'GEBCO 2026',
  href: 'https://www.gebco.net/data-products/gridded-bathymetry-data',
  notices: ['Only about a quarter of the sea floor is mapped by ship soundings; the rest is predicted from satellite altimetry at kilometre scale.'],
});

export const BLUE_MARBLE = Object.freeze({
  id: 'bmng',
  name: 'NASA Blue Marble Next Generation (monthly, 2004)',
  provenance: 'measured',
  licence: 'NASA – free to use with credit',
  attribution: 'NASA Earth Observatory, Blue Marble Next Generation (Reto Stöckli)',
  short: 'NASA Blue Marble',
  href: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/',
});

export const SNOW = Object.freeze({
  id: 'modis-snow',
  name: 'MODIS/Terra monthly snow cover (MOD10CM), via NASA GIBS',
  provenance: 'measured',
  licence: 'NASA open data',
  attribution: 'Snow: NASA MODIS/Terra (MOD10CM), imagery from NASA GIBS',
  short: 'NASA MODIS snow',
  href: 'https://nsidc.org/data/mod10cm',
});

export const SEA_ICE = Object.freeze({
  id: 'amsr-ice',
  name: 'AMSR-E / AMSR2 daily sea-ice concentration (12.5 km), via NASA GIBS',
  provenance: 'measured',
  licence: 'NASA open data',
  attribution: 'Sea ice: AMSR-E/AMSR2 (NASA, JAXA), imagery from NASA GIBS',
  short: 'AMSR sea ice',
  href: 'https://nsidc.org/data/au_si12',
});

export const NIGHT_LIGHTS = Object.freeze({
  id: 'black-marble',
  name: 'NASA Black Marble 2016 (VIIRS), via NASA GIBS',
  provenance: 'measured',
  licence: 'NASA open data',
  attribution: 'Night lights: NASA Black Marble 2016 (Suomi NPP VIIRS), imagery from NASA GIBS',
  short: 'NASA Black Marble',
  href: 'https://blackmarble.gsfc.nasa.gov/',
});

export const CLOUDS = Object.freeze({
  id: 'gfs',
  name: 'NOAA GFS 0.25° weather: cloud cover (low, middle, high), ceiling, convective cloud, precipitation rate and type, 10 m wind, 2 m temperature, visibility – NOAA Open Data on AWS',
  provenance: 'modelled',
  licence: 'NOAA open data (public domain)',
  attribution: 'Weather and clouds: NOAA Global Forecast System (GFS), via the NOAA Open Data Dissemination program',
  short: 'NOAA GFS weather',
  href: 'https://registry.opendata.aws/noaa-gfs-bdp-pds/',
});

export const SATELLITE_CLOUDS = Object.freeze({
  id: 'msg-clouds',
  name: 'EUMETSAT Meteosat (MSG, 0°) cloud mask and cloud top height, every 15 minutes since Sep 2020, EUMETView',
  provenance: 'measured',
  licence: 'CC BY 4.0 (EUMETSAT data policy for derived products)',
  attribution: 'Cloud placement: contains modified EUMETSAT Meteosat data (cloud mask, cloud top height), EUMETView',
  short: '© EUMETSAT',
  href: 'https://view.eumetsat.int/',
});

export const GEOID = Object.freeze({
  id: 'egm2008',
  name: 'EGM2008 geoid (0.5° grid from PROJ)',
  provenance: 'measured',
  licence: 'public domain',
  attribution: 'EGM2008: National Geospatial-Intelligence Agency (NGA), via the PROJ data CDN',
  href: 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84',
});

export const EPHEMERIS = Object.freeze({
  id: 'astronomy-engine',
  name: 'Astronomy Engine',
  provenance: 'modelled',
  licence: 'MIT',
  attribution: 'Astronomy Engine (Don Cross), validated against JPL Horizons',
  href: 'https://github.com/cosinekitty/astronomy',
});

export const SOURCES = Object.freeze([TERRAIN, BATHYMETRY, IMAGERY, IMAGERY_NRW, BUILDINGS_NRW, BUILDINGS_OSM, TREES_NRW, TIDES_DMI, BATHYMETRY_EU, BLUE_MARBLE, SNOW, SEA_ICE, NIGHT_LIGHTS, CLOUDS, SATELLITE_CLOUDS, GEOID, HERO_HEIGHTS, EPHEMERIS]);
