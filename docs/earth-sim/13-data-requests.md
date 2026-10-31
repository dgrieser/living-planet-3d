# 13 · How to request the data that is not downloadable

[← back to the plan index](README.md)

Almost everything in this plan is a free download. A handful of items need an account
(minutes, self-service) or a written request to a public body (days to weeks). This file
is the step-by-step guide, with ready-to-send emails. Contacts were checked on the
agencies' web pages in October 2026.

> **Order of work**: do Step 1 (accounts) right away; send the Step 2 emails early in M1
> so the answers are there for M2/M5. Nothing in M0–M1 depends on them, and the plan has
> a fallback for each one if the answer is "no".

---

## Step 1 – Accounts (self-service, free)

| Account | Needed for | Where | Notes |
|---|---|---|---|
| **Dataforsyningen** (Klimadatastyrelsen) | DHM 0.4 m, point cloud, orthophotos, skråfoto STAC API, GeoDanmark, Danmarks Dybdemodel | dataforsyningen.dk → *Log ind / Opret bruger* → create a **token** under your profile | the platform moves on 30 Nov 2026 – re-check the token afterwards |
| **Datafordeler** | BBR (roof/wall material, construction year), raster/point-cloud **FileDownloads API** | datafordeler.dk → create user → create an **API key** | service-user login ends 15 Jan 2027 – use API keys from the start |
| AVISO+ | FES2022b tide atlas | aviso.altimetry.fr → registration form → tick *FES (Finite Element Solution – Oceanic Tides Heights)* | licence: AVISO License (CC-BY-like; don't re-host the original files) |
| Copernicus Data Space (CDSE) | Sentinel-2 quarterly mosaics (fallback imagery), Copernicus DEM 2024_1 | dataspace.copernicus.eu | free |
| Copernicus Marine | North-West Shelf wave/physics forecasts (backup to DMI) | marine.copernicus.eu | free |
| Copernicus Climate Data Store | ERA5 / ERA5-Land via API (replay mode) | cds.climate.copernicus.eu → accept the ERA5 licence | alternatively ARCO-ERA5 (no account) |
| EUMETSAT Data Store | MTG cloud mask / cloud-top height (live clouds) | data.eumetsat.int | core products CC BY 4.0 |
| NASA Earthdata (optional) | Black Marble annual, NASADEM | urs.earthdata.nasa.gov | free |

Keys and tokens go only into the pipeline / scheduled-job environment on the mittwald
server, never into the client bundle ([11 §7](11-pipeline-hosting.md#7-ci)).

---

## Step 2 – Written requests

Five requests, in order of importance. Send them from your own address; the templates
are in Danish (preferred by Danish agencies) with an English version for reference.

### 2.1 Miljøstyrelsen (coastal data, formerly Kystdirektoratet) – Wadden Sea LiDAR

**What**: the bathymetric ("green") and topographic LiDAR surveys of the Danish Wadden Sea
around Fanø (Grådyb, Knudedyb, the tidal flats east and south of Fanø), the newest beach
and dune profiles along Fanø's west coast, and the newest intertidal DEM they hold.
**Why it matters**: it is the only high-resolution source for the tidal flats and
gullies – it decides how accurately the flats fall dry ([07 §4](07-water-tides-seafloor.md#4-the-tidal-flats-falling-dry)).
**Before writing**: look at the Kystdirektoratet datasets on **geodata-info.dk** (search
"Kystdirektoratet") and in **Kystatlas** – some may already be downloadable via
WMS/WFS; name the exact dataset titles in the email.
**To**: `mst@mst.dk` (subject line in Danish, mention "Kystdirektoratets data").

```text
Emne: Anmodning om kystdata for Vadehavet ved Fanø (grøn laser / pejledata) – ikke-kommercielt open source-projekt

Kære Miljøstyrelsen (tidl. Kystdirektoratet)

Jeg arbejder på et ikke-kommercielt, open source undervisningsprojekt, "Living Planet 3D"
(https://github.com/dgrieser/living-planet-3d), der viser Jorden som en interaktiv 3D-model
i browseren. Fanø og Vadehavet omkring øen skal modelleres i høj detalje, herunder tidevandet,
hvor vaderne tørlægges og oversvømmes.

Jeg vil gerne bede om adgang til følgende data, hvis I har dem:
1. Bathymetriske (grøn laser) og topografiske laserscanninger af Vadehavet omkring Fanø
   (Grådyb, Knudedyb, vaderne øst og syd for Fanø), helst som DEM (1–5 m) eller punktsky,
   med angivelse af opmålingsdato og højdesystem (DVR90).
2. De nyeste strand- og klitprofiler langs Fanøs vestkyst.
3. Eventuelle sammensatte højdemodeller for tidevandszonen (land–vade–rende).

Området: ca. 55,28–55,55° N, 8,20–8,56° Ø.
Data vil kun blive brugt til visualisering i projektet; afledte produkter (3D-terræn) bliver
offentligt tilgængelige med kildeangivelse efter jeres vilkår. Rådata vil ikke blive
videredistribueret, medmindre I tillader det.

Kan I oplyse, under hvilke vilkår data kan anvendes, og hvordan jeg kan få dem udleveret?

På forhånd tak.
Venlig hilsen
[Navn], [e-mail], [telefon]
```

<details><summary>English version</summary>

Subject: Request for coastal data for the Wadden Sea around Fanø (green LiDAR / survey
data) – non-commercial open-source project. I'm working on "Living Planet 3D", a
non-commercial open-source educational project showing the Earth as an interactive 3D model
in the browser; Fanø and the surrounding Wadden Sea are modelled in high detail including the
tides. Requested: (1) bathymetric (green) and topographic LiDAR of the Wadden Sea around
Fanø (Grådyb, Knudedyb, the flats east and south of Fanø) as a 1–5 m DEM or point cloud with
survey date and vertical datum; (2) the latest beach/dune profiles of Fanø's west coast;
(3) any merged intertidal DEMs. Area 55.28–55.55° N, 8.20–8.56° E. Used for visualisation
only; derived 3D terrain published with attribution under your terms; raw data not
redistributed unless permitted. Under which terms can the data be used and how can I obtain it?
</details>

**If the answer is no**: satellite-derived intertidal DEM (EMODnet 2020, CC BY 4.0) + DHM
where the flats were dry + Danmarks Dybdemodel 50 m. The flats will be right in their
large-scale shape; small gullies come from flow-accumulation modelling instead of survey.

### 2.2 Geodatastyrelsen / Danish Hydrographic Office – channel soundings

**What**: hydrographic survey data (soundings) for Grådyb, Knudedyb, Fanø Bugt and the
Nordby/Esbjerg harbour approaches.
**How it works** (from the agency's page "Purchase of depth data and bathymetric data"):
depth data are **sold**, the agency needs permission from third-party survey owners, and
**the Danish Defence must security-clear every transfer** (the agency applies on your
behalf). Accuracy varies by survey age.
**Before writing**: download the survey overview GeoPackage
`https://dhsds.gst.dk/api/files/download/hydrographic_survey_overview.dk.gpkg`
(+ readme PDF next to it), open it in QGIS, select the surveys inside the model box and
list their IDs and years in the email. Prefer surveys **after the Grådyb deepening**
(Port Esbjerg deepened the 21.6 km fairway from 9.3 m to 12.8 m; target −12.5 m MLWS).
**To**: `soe_policy@gst.dk` (cc `gst@gst.dk`).

```text
Emne: Forespørgsel om dybdedata (Grådyb, Knudedyb, Fanø) til ikke-kommercielt undervisningsprojekt

Kære Geodatastyrelsen / Søkortafdelingen

Jeg arbejder på et ikke-kommercielt, open source undervisningsprojekt, "Living Planet 3D"
(https://github.com/dgrieser/living-planet-3d), som viser Jorden som en interaktiv 3D-model.
Vadehavet ved Fanø skal vises med havbund, når vandet "fjernes", og tidevandet skal simuleres.

Jeg har gennemgået jeres oversigt over opmålinger (hydrographic_survey_overview.dk.gpkg) og
er interesseret i følgende opmålinger: [liste over ID'er og år].

Mine spørgsmål:
1. Kan data udleveres til dette formål, og hvad koster det? Findes der en ordning for
   ikke-kommercielle undervisnings-/forskningsformål?
2. Hvis punktdata ikke kan frigives, kan I så levere en gridmodel (fx 5–10 m) for området?
3. Under hvilke vilkår må et afledt, visualiseret terræn (ikke egnet til navigation)
   offentliggøres?

Data vil udelukkende blive brugt til visualisering og vil tydeligt blive markeret som
"ikke egnet til navigation".

Venlig hilsen
[Navn], [e-mail], [telefon]
```

**If the answer is no / too expensive**: Danmarks Dybdemodel 50 m (free) for the
channels; the channel shape after the deepening from the published fairway dimensions
(width/depth) as a synthetic profile – marked *modelled* in the provenance overlay.

### 2.3 Port Esbjerg – fairway surveys after the deepening

**What**: the latest multibeam survey (or as-built model) of the Grådyb fairway and the
harbour basins after the deepening to 12.8 m.
**To**: `adm@portesbjerg.dk` (general enquiries; ask to be forwarded to the hydrographic
survey responsible). Same template as 2.2, adapted ("sejlløbet i Grådyb efter
uddybningen", "seneste multibeam-opmåling"). Mention that GST may hold a copy and that
you are happy to receive it through GST if that is easier for them.

### 2.4 Landbrugsstyrelsen – licence confirmation for "Marker"

**What**: written confirmation of the licence for the yearly field-parcel files
(`landbrugsgeodata.fvm.dk/Download/Marker/Marker_<år>.zip`). A third-party catalogue
(fiboa / Source Cooperative) lists **CC0-1.0**; the agency's own site states no licence.
We only use the geometry + `Afgkode` / `Afgroede` (crop code/name) and **drop** `CVR`,
`Journalnr` and the subsidy fields.
**To**: `mail@sgav.dk` (the contact listed on lbst.dk).

```text
Emne: Licens for Marker-data (landbrugsgeodata.fvm.dk) – open source undervisningsprojekt

Kære Landbrugsstyrelsen

Jeg vil gerne bruge jeres årlige markfiler (Marker_<år>.zip) i et ikke-kommercielt, open
source undervisningsprojekt ("Living Planet 3D"), hvor afgrøden på hver mark vises i 3D
gennem sæsonen omkring Fanø. Jeg bruger kun markgeometri samt Afgkode/Afgroede og fjerner
CVR, Journalnr og tilskudsfelter.

Kan I bekræfte, hvilken licens data er udgivet under (fx CC0 eller CC BY 4.0), og hvordan I
ønsker kildeangivelsen formuleret?

Venlig hilsen
[Navn]
```

Until answered: treat as attribution required ("Landbrugsstyrelsen") and keep the derived
crop layer in its own tileset so it can be swapped if needed.

### 2.5 Beredskabsstyrelsen (Danish Emergency Management Agency) – AIS terms

**What**: confirmation that the free historical AIS files (aisdata.ais.dk) may be used to
animate the Fanø ferry along its recorded tracks, publishing only derived tracks of the
ferries (not the raw files). The DMA page says the data are free but states no licence;
the land-based AIS system is now under Beredskabsstyrelsen.
**To**: the AIS contact named on `dma.dk/safety-at-sea/navigational-information/ais-data`.
**Fallback**: animate the ferries along their **timetable** and the standard route – no
AIS needed (this is the default until confirmed).

### 2.6 Optional – Nationalpark Vadehavet / DCE

National park boundary and seal haul-out sites (for labels and, later, animals): ask
Nationalpark Vadehavet (via nationalparkvadehavet.dk) or DCE, Aarhus University (seal
monitoring). Low priority – nothing in v1 depends on it.

---

## Step 3 – Nothing to request for Lübbecke

Everything for Lübbecke is open and downloadable (Geobasis NRW, LWK, Wald und Holz NRW,
DWD, WSV/PEGELONLINE, BKG) – see [03](03-data-luebbecke.md). The only "request" is
courtesy: if the project is published, a short note to Geobasis NRW / Bezirksregierung
Köln is welcome but not required (dl-de/zero-2.0).

## Step 4 – Track the answers

Record every answer (date, contact, licence wording, conditions) in
`tools/earth-pipeline/sources.yaml` next to the dataset, and update the licence matrix in
[12 §5](12-roadmap-verification-licences.md#5-licence--attribution-matrix).
